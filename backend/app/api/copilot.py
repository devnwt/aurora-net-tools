"""Copilot: conversas, mensagens (loop LLM), aprovação de ações e tools (MCP)."""

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_master
from app.api.tenancy import new_org_id, owned, scope
from app.core.db import SessionLocal, get_session
from app.models import CopilotAction, CopilotConversation, CopilotMessage, CopilotTool, Device, User
from app.services import copilot, integrations

router = APIRouter(prefix="/copilot", tags=["copilot"], dependencies=[Depends(get_current_user)])

MODES = ("chat", "manual", "auto")


# === Serialização ===


def _conv(c: CopilotConversation) -> dict:
    return {
        "id": c.id, "title": c.title, "mode": c.mode, "device_ids": c.device_ids or [],
        "tokens_total": c.tokens_total or 0, "tokens_context": c.tokens_context or 0,
        "created_at": c.created_at.isoformat(), "updated_at": c.updated_at.isoformat(),
    }


def _msg(m: CopilotMessage) -> dict:
    return {
        "id": m.id, "role": m.role, "content": m.content, "reasoning": m.reasoning,
        "tool_calls": [tc.get("function", {}).get("name") for tc in (m.tool_calls or [])],
        "name": m.name, "created_at": m.created_at.isoformat(),
    }


def _action(a: CopilotAction) -> dict:
    return {
        "id": a.id, "device_id": a.device_id, "command": a.command, "rationale": a.rationale,
        "classification": a.classification, "high_risk": a.high_risk, "status": a.status,
        "output": a.output, "created_at": a.created_at.isoformat(),
    }


async def _get_conv(session: AsyncSession, conv_id: int, user: User) -> CopilotConversation:
    c = (await session.execute(select(CopilotConversation).where(CopilotConversation.id == conv_id))).scalar_one_or_none()
    return owned(c, user)


async def _detail(session: AsyncSession, conv: CopilotConversation) -> dict:
    await session.refresh(conv)  # recarrega atributos expirados pelos commits do loop
    msgs = (await session.execute(
        select(CopilotMessage).where(CopilotMessage.conversation_id == conv.id).order_by(CopilotMessage.id)
    )).scalars().all()
    actions = (await session.execute(
        select(CopilotAction).where(CopilotAction.conversation_id == conv.id).order_by(CopilotAction.id)
    )).scalars().all()
    return {"conversation": _conv(conv), "messages": [_msg(m) for m in msgs], "actions": [_action(a) for a in actions]}


# === Conversas ===


class ConvIn(BaseModel):
    title: str = "Nova conversa"
    mode: str = "manual"
    device_ids: list[int] = []


@router.get("/conversations")
async def list_conversations(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    rows = (await session.execute(
        scope(select(CopilotConversation), CopilotConversation, user).order_by(CopilotConversation.updated_at.desc())
    )).scalars().all()
    return [_conv(c) for c in rows]


@router.post("/conversations", status_code=201)
async def create_conversation(payload: ConvIn, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    mode = payload.mode if payload.mode in MODES else "manual"
    # valida devices da ORG
    devices: list[Device] = []
    for did in payload.device_ids:
        d = (await session.execute(select(Device).where(Device.id == did))).scalar_one_or_none()
        if d and (user.role == "master" or d.org_id == user.org_id):
            devices.append(d)
    prompt = await copilot.build_system_prompt(session, f"user:{user.id}", devices, mode)
    if payload.title and payload.title != "Nova conversa":
        title = payload.title
    elif devices:
        names = [d.name for d in devices]
        label = names[0] if len(names) == 1 else (f"{names[0]} e {names[1]}" if len(names) == 2 else f"{len(names)} devices")
        title = f"Nova Conversa Sobre {label}"
    else:
        title = "Nova conversa"
    c = CopilotConversation(
        org_id=new_org_id(user), user_id=user.id or None, title=title,
        mode=mode, device_ids=[d.id for d in devices], system_prompt=prompt,
    )
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return _conv(c)


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _detail(session, await _get_conv(session, conv_id, user))


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(conv_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get_conv(session, conv_id, user)
    await session.delete(c)
    await session.commit()


class MessageIn(BaseModel):
    content: str


@router.post("/conversations/{conv_id}/messages")
async def post_message(conv_id: int, payload: MessageIn, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    conv = await _get_conv(session, conv_id, user)
    if not payload.content.strip():
        raise HTTPException(400, "mensagem vazia")
    session.add(CopilotMessage(conversation_id=conv.id, role="user", content=payload.content.strip()))
    conv.title = conv.title if conv.title != "Nova conversa" else payload.content.strip()[:60]
    await session.commit()
    try:
        await copilot.advance(session, conv, user)
    except copilot.CopilotError as e:
        raise HTTPException(400, str(e))
    return await _detail(session, conv)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/conversations/{conv_id}/stream")
async def stream_message(conv_id: int, payload: MessageIn, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    conv = await _get_conv(session, conv_id, user)
    if not payload.content.strip():
        raise HTTPException(400, "mensagem vazia")
    session.add(CopilotMessage(conversation_id=conv.id, role="user", content=payload.content.strip()))
    conv.title = conv.title if conv.title != "Nova conversa" else payload.content.strip()[:60]
    await session.commit()

    async def gen():
        # Sessão própria: o gerador roda enquanto a resposta transmite (fora do
        # ciclo da sessão da request), então re-carregamos a conversa aqui.
        async with SessionLocal() as s2:
            conv2 = (await s2.execute(select(CopilotConversation).where(CopilotConversation.id == conv_id))).scalar_one()
            try:
                async for ev in copilot.advance_stream(s2, conv2, user):
                    yield _sse(ev.get("type", "message"), ev)
                yield _sse("done", await _detail(s2, conv2))
            except copilot.CopilotError as e:
                yield _sse("error", {"detail": str(e)})
            except Exception:  # noqa: BLE001
                yield _sse("error", {"detail": "erro interno do Copilot"})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",  # nginx: não bufferizar o SSE
    })


# === Ações (aprovação) ===


async def _get_action(session: AsyncSession, action_id: int, user: User) -> tuple[CopilotConversation, CopilotAction]:
    a = (await session.execute(select(CopilotAction).where(CopilotAction.id == action_id))).scalar_one_or_none()
    if a is None:
        raise HTTPException(404, "ação não encontrada")
    conv = await _get_conv(session, a.conversation_id, user)
    return conv, a


@router.post("/actions/{action_id}/approve")
async def approve_action(action_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    conv, a = await _get_action(session, action_id, user)
    try:
        await copilot.resume_action(session, conv, a, user, approve=True)
    except copilot.CopilotError as e:
        raise HTTPException(400, str(e))
    return await _detail(session, conv)


@router.post("/actions/{action_id}/reject")
async def reject_action(action_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    conv, a = await _get_action(session, action_id, user)
    try:
        await copilot.resume_action(session, conv, a, user, approve=False)
    except copilot.CopilotError as e:
        raise HTTPException(400, str(e))
    return await _detail(session, conv)


# === Ferramentas embutidas (SearXNG + filesystem) ===


def _builtin(row) -> dict:
    return {
        "web": {"enabled": row.copilot_web_enabled, "url": row.copilot_web_url},
        "fs": {"enabled": row.copilot_fs_enabled, "root": row.copilot_fs_root},
    }


@router.get("/builtin", dependencies=[Depends(require_master)])
async def get_builtin(session: AsyncSession = Depends(get_session)):
    return _builtin(await integrations.get_or_create_settings(session, None))


class WebIn(BaseModel):
    enabled: bool | None = None
    url: str | None = None


class FsIn(BaseModel):
    enabled: bool | None = None
    root: str | None = None


class BuiltinIn(BaseModel):
    web: WebIn | None = None
    fs: FsIn | None = None


@router.put("/builtin", dependencies=[Depends(require_master)])
async def put_builtin(payload: BuiltinIn, session: AsyncSession = Depends(get_session)):
    row = await integrations.get_or_create_settings(session, None)
    if payload.web is not None:
        d = payload.web.model_dump(exclude_unset=True)
        if "enabled" in d:
            row.copilot_web_enabled = d["enabled"]
        if "url" in d:
            row.copilot_web_url = d["url"] or ""
    if payload.fs is not None:
        d = payload.fs.model_dump(exclude_unset=True)
        if "enabled" in d:
            row.copilot_fs_enabled = d["enabled"]
        if "root" in d:
            row.copilot_fs_root = d["root"] or "/tmp"
    await session.commit()
    await session.refresh(row)
    return _builtin(row)


# === Tools externas (MCP) ===


def _tool(t: CopilotTool) -> dict:
    cfg = t.config or {}
    return {
        "id": t.id, "kind": t.kind, "name": t.name, "enabled": t.enabled,
        "url": cfg.get("url", ""), "spec_url": cfg.get("spec_url", ""), "base_url": cfg.get("base_url", ""),
        "auth_header": cfg.get("auth_header", ""), "auth_set": bool(cfg.get("auth_value")),
        "content_len": len(cfg.get("content", "")),
    }


class ToolIn(BaseModel):
    kind: str = "mcp"  # mcp | openapi | skill
    name: str
    url: str = ""  # MCP
    spec_url: str = ""  # OpenAPI
    base_url: str = ""  # OpenAPI (opcional; senão usa servers[] da spec)
    content: str = ""  # Skill (texto/markdown)
    auth_header: str | None = None
    auth_value: str | None = None
    enabled: bool = True


@router.get("/tools", dependencies=[Depends(require_master)])
async def list_tools(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(CopilotTool).where(CopilotTool.org_id.is_(None)).order_by(CopilotTool.name))).scalars().all()
    return [_tool(t) for t in rows]


@router.post("/tools", status_code=201, dependencies=[Depends(require_master)])
async def create_tool(payload: ToolIn, session: AsyncSession = Depends(get_session)):
    if payload.kind not in ("mcp", "openapi", "skill"):
        raise HTTPException(400, "kind inválido (use mcp | openapi | skill)")
    auth = {"auth_header": payload.auth_header or "", "auth_value": payload.auth_value or ""}
    if payload.kind == "mcp":
        if not payload.url:
            raise HTTPException(400, "MCP exige url")
        config = {"url": payload.url, **auth}
    elif payload.kind == "openapi":
        if not payload.spec_url:
            raise HTTPException(400, "OpenAPI exige spec_url")
        config = {"spec_url": payload.spec_url, "base_url": payload.base_url, **auth}
    else:  # skill
        if not payload.content.strip():
            raise HTTPException(400, "Skill exige conteúdo")
        config = {"content": payload.content}
    t = CopilotTool(org_id=None, kind=payload.kind, name=payload.name, config=config, enabled=payload.enabled)
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return _tool(t)


@router.delete("/tools/{tool_id}", status_code=204, dependencies=[Depends(require_master)])
async def delete_tool(tool_id: int, session: AsyncSession = Depends(get_session)):
    t = (await session.execute(select(CopilotTool).where(CopilotTool.id == tool_id))).scalar_one_or_none()
    if t is None:
        raise HTTPException(404, "tool não encontrada")
    await session.delete(t)
    await session.commit()


@router.post("/tools/{tool_id}/test", dependencies=[Depends(require_master)])
async def test_tool(tool_id: int, session: AsyncSession = Depends(get_session)):
    t = (await session.execute(select(CopilotTool).where(CopilotTool.id == tool_id))).scalar_one_or_none()
    if t is None:
        raise HTTPException(404, "tool não encontrada")

    if t.kind == "skill":
        return {"ok": True, "detail": f"Skill '{t.name}' com {len(t.config.get('content', ''))} caracteres."}

    if t.kind == "openapi":
        entries = await copilot.gather_openapi_tools(session, t.org_id)
        mine = [e for e in entries if e["config"].get("spec_url") == t.config.get("spec_url")]
        if not mine:
            return {"ok": False, "detail": "spec inacessível ou sem operações"}
        return {"ok": True, "detail": f"{len(mine)} operação(ões): " + ", ".join(e["name"] for e in mine[:15])}

    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    try:
        async with streamablehttp_client(t.config.get("url"), headers=copilot._mcp_headers(t.config)) as (r, w, _):
            async with ClientSession(r, w) as sess:
                await sess.initialize()
                listed = await sess.list_tools()
                return {"ok": True, "detail": f"{len(listed.tools)} tool(s): " + ", ".join(x.name for x in listed.tools[:20])}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "detail": f"{type(e).__name__}: {e}"}
