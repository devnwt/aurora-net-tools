"""Copilot: orquestra o loop de tool-calling do LLM sobre devices.

Fluxo: monta mensagens (system + histórico) → chama o LLM (config da ORG em
Settings→LLM) com ferramentas → processa tool_calls. Leituras rodam na hora
(classifier read-only); escritas viram `CopilotAction`: em modo `auto` (e fora
da denylist) executam sozinhas; em `manual` ou alto risco, ficam pendentes e o
loop suspende até aprovação. Tudo auditado via `runner`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt
from app.drivers import routeros
from app.drivers.base import DriverError, WriteBlocked
from app.drivers.classifier import classify_command
from app.models import CopilotAction, CopilotConversation, CopilotMessage, CopilotTool, Device, OrgSettings, User
from app.models.enums import Classification, DeviceType, Protocol
from app.services import integrations, runner
from app.services.connlock import TargetBusy
from app.services.credentials import CredentialNotFound

log = logging.getLogger("aurora.copilot")

MAX_ITERS = 6


class CopilotError(Exception):
    """Erro amigável para a API (config ausente, LLM indisponível, etc.)."""


# === Denylist de alto risco (sempre exige aprovação, mesmo em auto) ===

_HIGH_RISK = [
    r"reset-configuration",
    r"/system\s+reset",
    r"/system\s+reboot",
    r"/system\s+shutdown",
    r"routerboard\s+.*reset",
    r"/user\s+(remove|disable|set)",
    r"/interface\s+.*\bdisable\b",
    r"chain=input\s+.*action=drop|action=drop\s+.*chain=input",
]


def is_high_risk(command: str) -> bool:
    c = (command or "").lower()
    return any(re.search(p, c) for p in _HIGH_RISK)


# === Prompt de sistema por tipo de device + facts ===

_PROMPTS = {
    DeviceType.routeros: (
        "Você é o Aurora Copilot, um especialista em MikroTik RouterOS assistindo um operador de NOC.\n"
        "- Para INSPECIONAR o device, chame `run_read_command` com um comando de leitura (terminando em `print`).\n"
        "- Para ALTERAR a configuração, chame `propose_write` com UM comando por vez e uma justificativa clara. "
        "O comando NÃO roda sozinho: precisa da aprovação do operador (exceto em modo automático, quando não for de alto risco).\n"
        "- Use sintaxe terse do RouterOS. Prefira mudanças mínimas e reversíveis; explique o que cada comando faz.\n"
        "- Comandos destrutivos (reset-configuration, reboot, remover usuário) SEMPRE exigem aprovação manual.\n"
        "- Você pode consultar os templates cadastrados com `list_templates` e propor os comandos deles.\n"
        "- Responda no idioma do operador (português)."
    ),
    DeviceType.huawei: "Você é o Aurora Copilot, especialista em Huawei. Inspecione com `run_read_command`; proponha mudanças com `propose_write` (exigem aprovação). Responda em português.",
    DeviceType.cisco: "Você é o Aurora Copilot, especialista em Cisco IOS. Inspecione com `run_read_command`; proponha mudanças com `propose_write` (exigem aprovação). Responda em português.",
}


def _base_prompt(device_type: DeviceType) -> str:
    return _PROMPTS.get(device_type, "Você é o Aurora Copilot, um assistente de rede. Responda em português.")


def _protocol(device: Device) -> Protocol | None:
    if device.ssh_enabled:
        return Protocol.ssh
    if device.telnet_enabled:
        return Protocol.telnet
    return None


async def gather_facts(session: AsyncSession, actor: str, device: Device) -> str:
    """Bloco de texto com identidade/board/versão/interfaces/serviços do device."""
    if device.device_type != DeviceType.routeros:
        return f"Device '{device.name}' ({device.ip}) — tipo {device.device_type.value}."
    proto = _protocol(device)
    if proto is None:
        return f"Device '{device.name}' ({device.ip}) — sem SSH/Telnet habilitado."
    try:
        out = await runner.exec_many(
            session, actor=actor, device=device, protocol=proto,
            commands=[routeros.CMD_RESOURCE_BOARD, routeros.CMD_INTERFACES, routeros.CMD_SERVICES],
        )
    except Exception as e:
        return f"Device '{device.name}' ({device.ip}) — inacessível no momento ({type(e).__name__})."
    props = routeros.parse_props(out[0])
    summ = routeros.summarize_system(props, None)
    ifaces = [i.get("name", "") for i in routeros.parse_terse(out[1]) if i.get("name")]
    svcs = [f"{s.get('name')}:{s.get('port')}" for s in routeros.parse_terse(out[2]) if "D" not in (s.get("flags") or "") and "X" not in (s.get("flags") or "")]
    return (
        f"Device '{device.name}' (IP {device.ip}, id {device.id}) — RouterOS\n"
        f"  board: {summ.get('board')} | versão: {summ.get('version')} | arch: {summ.get('architecture')}\n"
        f"  interfaces: {', '.join(ifaces) or '—'}\n"
        f"  serviços ativos: {', '.join(svcs) or '—'}"
    )


async def build_system_prompt(session: AsyncSession, actor: str, devices: list[Device], mode: str) -> str:
    if not devices:
        return _base_prompt(DeviceType.routeros) + "\n\nNenhum device selecionado."
    primary = devices[0].device_type
    parts = [_base_prompt(primary)]
    parts.append(f"\nModo de operação atual: {mode}.")
    if len(devices) > 1:
        parts.append(f"Você opera sobre {len(devices)} devices; indique o device_id em cada comando.")
    parts.append("\n=== Devices selecionados ===")
    for d in devices:
        parts.append(await gather_facts(session, actor, d))
    return "\n".join(parts)


# === Ferramentas expostas ao LLM ===

STATIC_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_read_command",
            "description": "Executa um comando de LEITURA (read-only, termina em print) no device e retorna a saída.",
            "parameters": {
                "type": "object",
                "properties": {
                    "device_id": {"type": "integer", "description": "id do device alvo"},
                    "command": {"type": "string", "description": "comando de leitura RouterOS (ex.: /ip address print)"},
                },
                "required": ["device_id", "command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_device_facts",
            "description": "Retorna uma seção de configuração do device.",
            "parameters": {
                "type": "object",
                "properties": {
                    "device_id": {"type": "integer"},
                    "section": {"type": "string", "enum": ["interfaces", "ip_addresses", "firewall_filter", "firewall_nat", "dhcp_servers", "routes", "services", "logs"]},
                },
                "required": ["device_id", "section"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_templates",
            "description": "Lista os templates de comando cadastrados na organização.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_write",
            "description": "Propõe UM comando de escrita para o device. Exige aprovação do operador (salvo modo automático e não sendo de alto risco).",
            "parameters": {
                "type": "object",
                "properties": {
                    "device_id": {"type": "integer"},
                    "command": {"type": "string", "description": "um único comando RouterOS de configuração"},
                    "rationale": {"type": "string", "description": "por que este comando resolve o pedido"},
                },
                "required": ["device_id", "command", "rationale"],
            },
        },
    },
]

_SECTION_CMD = {
    "interfaces": routeros.CMD_INTERFACES,
    "ip_addresses": routeros.CMD_IP_ADDRESSES,
    "firewall_filter": routeros.CMD_FW_FILTER,
    "firewall_nat": routeros.CMD_FW_NAT,
    "dhcp_servers": routeros.CMD_DHCP_SERVERS,
    "routes": routeros.CMD_ROUTES,
    "services": routeros.CMD_SERVICES,
    "logs": routeros.CMD_LOGS,
}


# === Ferramentas embutidas: Web (SearXNG) e Filesystem (/tmp) ===

WEB_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Busca na web via SearXNG. Use para informação externa/atualizada (docs, CVEs, etc.).",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "num_results": {"type": "integer", "description": "máx. de resultados (padrão 5)"},
            },
            "required": ["query"],
        },
    },
}

FS_TOOLS = [
    {"type": "function", "function": {
        "name": "fs_list", "description": "Lista arquivos/pastas no diretório de trabalho (raiz configurada).",
        "parameters": {"type": "object", "properties": {"path": {"type": "string", "description": "subcaminho (padrão raiz)"}}}}},
    {"type": "function", "function": {
        "name": "fs_read", "description": "Lê o conteúdo de um arquivo de texto no diretório de trabalho.",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {
        "name": "fs_write", "description": "Escreve/sobrescreve um arquivo de texto no diretório de trabalho (rascunho).",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}}},
]

_FS_MAX = 200_000  # 200 KB por arquivo


async def _do_web_search(cfg: OrgSettings, args: dict) -> str:
    q = str(args.get("query", "")).strip()
    if not q:
        return "query vazia"
    n = min(int(args.get("num_results", 5) or 5), 10)
    url = (cfg.copilot_web_url or "").rstrip("/") + "/search"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(url, params={"q": q, "format": "json"}, headers={"Accept": "application/json"})
            r.raise_for_status()
            results = (r.json().get("results") or [])[:n]
    except Exception as e:
        return f"erro na busca (SearXNG): {type(e).__name__}: {e}"
    if not results:
        return "sem resultados"
    return json.dumps([{"title": x.get("title"), "url": x.get("url"), "content": (x.get("content") or "")[:300]} for x in results], ensure_ascii=False)


def _fs_resolve(root: str, path: str) -> tuple[str, str]:
    root = os.path.realpath(root or "/tmp")
    target = os.path.realpath(os.path.join(root, (path or "").lstrip("/")))
    if target != root and not target.startswith(root + os.sep):
        raise ValueError("caminho fora da raiz permitida")
    return root, target


async def _do_fs(cfg: OrgSettings, op: str, args: dict) -> str:
    def _run() -> str:
        try:
            root, target = _fs_resolve(cfg.copilot_fs_root or "/tmp", str(args.get("path", "")))
        except ValueError as e:
            return f"erro: {e}"
        try:
            if op == "list":
                base = target if os.path.isdir(target) else root
                items = sorted(os.listdir(base))
                return json.dumps([{"name": n, "dir": os.path.isdir(os.path.join(base, n))} for n in items[:200]], ensure_ascii=False)
            if op == "read":
                if not os.path.isfile(target):
                    return "arquivo não encontrado"
                if os.path.getsize(target) > _FS_MAX:
                    return f"arquivo grande demais (> {_FS_MAX} bytes)"
                with open(target, encoding="utf-8", errors="replace") as fh:
                    return fh.read()
            if op == "write":
                content = str(args.get("content", ""))
                if len(content.encode("utf-8")) > _FS_MAX:
                    return f"conteúdo grande demais (> {_FS_MAX} bytes)"
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "w", encoding="utf-8") as fh:
                    fh.write(content)
                return f"escrito: {target} ({len(content)} chars)"
        except Exception as e:
            return f"erro: {type(e).__name__}: {e}"
        return "operação inválida"

    return await asyncio.to_thread(_run)


# === MCP (HTTP Stream) ===


def _mcp_headers(config: dict) -> dict:
    h = config.get("auth_header")
    v = config.get("auth_value")
    return {h: v} if h and v else {}


async def gather_mcp_tools(session: AsyncSession, org_id: int | None) -> list[dict]:
    """Descobre tools dos MCPs registrados na ORG. Falha silenciosa por servidor."""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    stmt = select(CopilotTool).where(CopilotTool.kind == "mcp", CopilotTool.enabled.is_(True))
    if org_id is not None:
        stmt = stmt.where(CopilotTool.org_id == org_id)
    rows = (await session.execute(stmt)).scalars().all()

    out: list[dict] = []
    for row in rows:
        url = (row.config or {}).get("url")
        if not url:
            continue
        try:
            async with streamablehttp_client(url, headers=_mcp_headers(row.config)) as (r, w, _):
                async with ClientSession(r, w) as sess:
                    await sess.initialize()
                    listed = await sess.list_tools()
                    for t in listed.tools:
                        safe = "mcp_" + re.sub(r"[^A-Za-z0-9_]", "_", t.name)
                        out.append({
                            "kind": "mcp",
                            "name": safe,
                            "orig": t.name,
                            "config": row.config,
                            "openai": {
                                "type": "function",
                                "function": {
                                    "name": safe,
                                    "description": f"[{row.name}] {(t.description or '')[:900]}",
                                    "parameters": t.inputSchema or {"type": "object", "properties": {}},
                                },
                            },
                        })
        except Exception as e:
            log.warning("MCP %s indisponível: %s", row.name, e)
    return out


async def _call_mcp(entry: dict, args: dict) -> str:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    url = entry["config"]["url"]
    try:
        async with streamablehttp_client(url, headers=_mcp_headers(entry["config"])) as (r, w, _):
            async with ClientSession(r, w) as sess:
                await sess.initialize()
                res = await sess.call_tool(entry["orig"], args)
                texts = [getattr(c, "text", "") for c in (res.content or []) if getattr(c, "text", "")]
                return "\n".join(texts) or "(sem conteúdo)"
    except Exception as e:
        return f"erro ao chamar MCP: {type(e).__name__}: {e}"


# === OpenAPI-compatible ===

_HTTP_METHODS = ("get", "post", "put", "patch", "delete")


def _resolve_refs(node, spec, seen=None):
    """Resolve $ref (#/components/...) de forma recursiva e limitada."""
    seen = seen or set()
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/"):
            if ref in seen:
                return {"type": "object"}
            target = spec
            for part in ref[2:].split("/"):
                target = (target or {}).get(part, {})
            return _resolve_refs(target, spec, seen | {ref})
        return {k: _resolve_refs(v, spec, seen) for k, v in node.items()}
    if isinstance(node, list):
        return [_resolve_refs(v, spec, seen) for v in node]
    return node


def _openapi_base(spec: dict, config: dict, spec_url: str) -> str:
    base = config.get("base_url") or ""
    if not base:
        servers = spec.get("servers") or []
        base = servers[0].get("url", "") if servers else ""
    if base.startswith("http"):
        return base
    # base relativo → resolve contra a origem da spec
    from urllib.parse import urljoin, urlparse
    origin = f"{urlparse(spec_url).scheme}://{urlparse(spec_url).netloc}"
    return urljoin(origin, base or "/")


def _openapi_entries(spec: dict, row: CopilotTool) -> list[dict]:
    spec = _resolve_refs(spec, spec)
    base = _openapi_base(spec, row.config or {}, (row.config or {}).get("spec_url", ""))
    entries: list[dict] = []
    for path, item in (spec.get("paths") or {}).items():
        shared = item.get("parameters", []) if isinstance(item, dict) else []
        for method in _HTTP_METHODS:
            op = item.get(method) if isinstance(item, dict) else None
            if not isinstance(op, dict):
                continue
            opid = op.get("operationId") or f"{method}_{path}"
            name = "oapi_" + re.sub(r"[^A-Za-z0-9_]", "_", opid)[:56]
            props, required, locs = {}, [], {}
            for p in list(op.get("parameters", [])) + list(shared):
                pn = p.get("name")
                if not pn:
                    continue
                props[pn] = {**p.get("schema", {"type": "string"}), "description": p.get("description", "")}
                locs[pn] = p.get("in", "query")
                if p.get("required"):
                    required.append(pn)
            has_body = False
            rb = op.get("requestBody") or {}
            schema = (rb.get("content", {}).get("application/json", {}) or {}).get("schema")
            if schema:
                props["body"] = schema
                has_body = True
                if rb.get("required"):
                    required.append("body")
            entries.append({
                "kind": "openapi", "name": name, "method": method, "path": path, "base": base,
                "locs": locs, "has_body": has_body, "config": row.config or {},
                "openai": {"type": "function", "function": {
                    "name": name,
                    "description": f"[{row.name}] {(op.get('summary') or op.get('description') or opid)[:900]}",
                    "parameters": {"type": "object", "properties": props, "required": required},
                }},
            })
    return entries


async def gather_openapi_tools(session: AsyncSession, org_id: int | None) -> list[dict]:
    stmt = select(CopilotTool).where(CopilotTool.kind == "openapi", CopilotTool.enabled.is_(True))
    if org_id is not None:
        stmt = stmt.where(CopilotTool.org_id == org_id)
    rows = (await session.execute(stmt)).scalars().all()
    out: list[dict] = []
    for row in rows:
        url = (row.config or {}).get("spec_url")
        if not url:
            continue
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(url, headers=_mcp_headers(row.config))
                r.raise_for_status()
                out.extend(_openapi_entries(r.json(), row))
        except Exception as e:
            log.warning("OpenAPI %s indisponível: %s", row.name, e)
    return out


async def _call_openapi(entry: dict, args: dict) -> str:
    path = entry["path"]
    query: dict = {}
    headers = _mcp_headers(entry["config"])
    for k, v in args.items():
        if k == "body":
            continue
        loc = entry["locs"].get(k, "query")
        if loc == "path":
            path = path.replace("{" + k + "}", str(v))
        elif loc == "header":
            headers[k] = str(v)
        else:
            query[k] = v
    url = entry["base"].rstrip("/") + path
    json_body = args.get("body") if entry["has_body"] else None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.request(entry["method"].upper(), url, params=query, json=json_body, headers=headers)
        return f"HTTP {r.status_code}: {r.text[:4000]}"
    except Exception as e:
        return f"erro ao chamar OpenAPI: {type(e).__name__}: {e}"


# === Skills (injetadas no system prompt) ===


async def gather_skills(session: AsyncSession, org_id: int | None) -> str:
    stmt = select(CopilotTool).where(CopilotTool.kind == "skill", CopilotTool.enabled.is_(True))
    if org_id is not None:
        stmt = stmt.where(CopilotTool.org_id == org_id)
    rows = (await session.execute(stmt)).scalars().all()
    blocks = [f"## Skill: {r.name}\n{(r.config or {}).get('content', '')}" for r in rows if (r.config or {}).get("content")]
    return "\n\n".join(blocks)


# === Helpers de mensagem/estado ===


def _add_tool_msg(session: AsyncSession, conv: CopilotConversation, tc_id: str, name: str, content: str) -> None:
    session.add(CopilotMessage(conversation_id=conv.id, role="tool", tool_call_id=tc_id, name=name, content=content[:8000]))


async def _messages(session: AsyncSession, conv: CopilotConversation) -> list[CopilotMessage]:
    rows = (await session.execute(
        select(CopilotMessage).where(CopilotMessage.conversation_id == conv.id).order_by(CopilotMessage.id)
    )).scalars().all()
    return list(rows)


async def unanswered_tool_calls(session: AsyncSession, conv: CopilotConversation) -> list[str]:
    """tool_call ids da última mensagem assistant que ainda não têm resposta (tool msg)."""
    msgs = await _messages(session, conv)
    last_assistant = next((m for m in reversed(msgs) if m.role == "assistant"), None)
    if not last_assistant or not last_assistant.tool_calls:
        return []
    answered = {m.tool_call_id for m in msgs if m.role == "tool" and m.tool_call_id}
    return [tc["id"] for tc in last_assistant.tool_calls if tc.get("id") not in answered]


def _build_api_messages(system_prompt: str, msgs: list[CopilotMessage]) -> list[dict]:
    out = [{"role": "system", "content": system_prompt}]
    for m in msgs:
        if m.role == "assistant":
            a: dict = {"role": "assistant", "content": m.content or None}
            if m.tool_calls:
                a["tool_calls"] = m.tool_calls
            out.append(a)
        elif m.role == "tool":
            out.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content})
        else:
            out.append({"role": "user", "content": m.content})
    return out


async def _chat(cfg: OrgSettings, messages: list[dict], tools: list[dict] | None) -> dict:
    base = (cfg.llm_base_url or "").rstrip("/")
    headers = {"Authorization": f"Bearer {decrypt(cfg.llm_api_key)}"} if cfg.llm_api_key else {}
    body: dict = {"model": cfg.llm_model, "messages": messages, "temperature": 0.2}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{base}/chat/completions", headers=headers, json=body)
    except Exception as e:
        raise CopilotError(f"LLM inacessível: {type(e).__name__}: {e}")
    if r.status_code >= 300:
        raise CopilotError(f"LLM HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


# === Execução de comandos (leitura/escrita) ===


async def _device_for(session: AsyncSession, conv: CopilotConversation, user: User, device_id: int) -> Device | None:
    if device_id not in (conv.device_ids or []):
        return None
    d = (await session.execute(select(Device).where(Device.id == device_id))).scalar_one_or_none()
    if d is None or (user.role != "master" and d.org_id != user.org_id):
        return None
    return d


async def _retry_busy(factory, tries: int = 4, delay: float = 1.5):
    """Repete em TargetBusy (o poller pode segurar o lock do device por instantes)."""
    for i in range(tries):
        try:
            return await factory()
        except TargetBusy:
            if i == tries - 1:
                raise
            await asyncio.sleep(delay)


async def _read(session: AsyncSession, user: User, device: Device, command: str) -> str:
    proto = _protocol(device)
    if proto is None:
        return "device sem SSH/Telnet habilitado"
    try:
        out = await _retry_busy(lambda: runner.exec_command(session, actor=f"user:{user.id}", device=device, protocol=proto, command=command))
        return out.strip() or "(sem saída)"
    except WriteBlocked:
        return "esse comando é de ESCRITA; use propose_write para alterações."
    except (CredentialNotFound, TargetBusy, DriverError) as e:
        return f"erro: {e}"


async def _exec_write(session: AsyncSession, user: User, device: Device, command: str) -> tuple[bool, str]:
    proto = _protocol(device)
    if proto is None:
        return False, "device sem SSH/Telnet habilitado"
    try:
        out = await _retry_busy(lambda: runner.exec_write(session, actor=f"user:{user.id}", device=device, protocol=proto, command=command))
        return True, out.strip() or "(ok)"
    except (CredentialNotFound, TargetBusy, DriverError) as e:
        return False, f"erro: {e}"


# === Processamento de uma tool_call ===


async def _process_tool_call(session, conv, user, tc, ext_tools, cfg) -> None:
    tc_id = tc.get("id")
    fn = tc.get("function", {}).get("name", "")
    try:
        args = json.loads(tc.get("function", {}).get("arguments") or "{}")
    except json.JSONDecodeError:
        args = {}

    if fn == "web_search":
        _add_tool_msg(session, conv, tc_id, fn, await _do_web_search(cfg, args))

    elif fn in ("fs_list", "fs_read", "fs_write"):
        _add_tool_msg(session, conv, tc_id, fn, await _do_fs(cfg, fn[3:], args))

    elif fn == "run_read_command":
        d = await _device_for(session, conv, user, int(args.get("device_id", 0)))
        content = "device inválido/fora do escopo" if not d else await _read(session, user, d, str(args.get("command", "")))
        _add_tool_msg(session, conv, tc_id, fn, content)

    elif fn == "get_device_facts":
        d = await _device_for(session, conv, user, int(args.get("device_id", 0)))
        cmd = _SECTION_CMD.get(str(args.get("section", "")))
        content = "device/seção inválidos" if not (d and cmd) else await _read(session, user, d, cmd)
        _add_tool_msg(session, conv, tc_id, fn, content)

    elif fn == "list_templates":
        content = await _list_templates(session, user)
        _add_tool_msg(session, conv, tc_id, fn, content)

    elif fn == "propose_write":
        await _propose_write(session, conv, user, tc_id, args)

    else:
        entry = next((t for t in ext_tools if t["name"] == fn), None)
        if entry and entry.get("kind") == "openapi":
            content = await _call_openapi(entry, args)
        elif entry:
            content = await _call_mcp(entry, args)
        else:
            content = f"ferramenta desconhecida: {fn}"
        _add_tool_msg(session, conv, tc_id, fn, content)


async def _list_templates(session: AsyncSession, user: User) -> str:
    from app.models import CommandTemplate

    stmt = select(CommandTemplate).where(CommandTemplate.enabled.is_(True))
    if user.role != "master":
        stmt = stmt.where(CommandTemplate.org_id == user.org_id)
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return "nenhum template cadastrado."
    return json.dumps([
        {"id": t.id, "name": t.name, "category": t.category, "description": t.description, "body": t.body[:1500]}
        for t in rows
    ], ensure_ascii=False)


async def _propose_write(session, conv, user, tc_id, args) -> None:
    device_id = int(args.get("device_id", 0))
    command = str(args.get("command", "")).strip()
    rationale = str(args.get("rationale", ""))
    d = await _device_for(session, conv, user, device_id)
    if not d:
        _add_tool_msg(session, conv, tc_id, "propose_write", "device inválido/fora do escopo")
        return
    if not command:
        _add_tool_msg(session, conv, tc_id, "propose_write", "comando vazio")
        return

    classification = classify_command(d.device_type, command)
    # Leitura via propose_write: apenas roda (é seguro).
    if classification == Classification.read:
        content = await _read(session, user, d, command)
        session.add(CopilotAction(conversation_id=conv.id, device_id=d.id, tool_call_id=tc_id, command=command,
                                  rationale=rationale, classification="read", status="executed", output=content[:8000]))
        _add_tool_msg(session, conv, tc_id, "propose_write", content)
        return

    high = is_high_risk(command)
    action = CopilotAction(conversation_id=conv.id, device_id=d.id, tool_call_id=tc_id, command=command,
                           rationale=rationale, classification="write", high_risk=high, status="pending")
    session.add(action)

    if conv.mode == "auto" and not high:
        ok, out = await _exec_write(session, user, d, command)
        action.status = "executed" if ok else "failed"
        action.output = out[:8000]
        _add_tool_msg(session, conv, tc_id, "propose_write", f"[{'executado' if ok else 'falhou'}] {out}")
    # manual OU alto risco: fica pending, SEM tool msg → suspende o loop.


# === Loop principal ===


async def _require_llm(session: AsyncSession):
    """Config de LLM é GLOBAL (org_id NULL), gerida em Super Admin → LLM."""
    cfg = await integrations.get_settings(session, None)
    if cfg is None or not cfg.llm_enabled or not cfg.llm_base_url:
        raise CopilotError("LLM não configurado/habilitado em Super Admin → LLM.")
    return cfg


async def _tools_and_system(session: AsyncSession, conv: CopilotConversation, cfg) -> tuple[list[dict], list[dict] | None, str]:
    # Tools do Copilot (MCP/OpenAPI/Skill/web/fs) são GLOBAIS (org_id NULL), geridas em Super Admin.
    if conv.mode == "chat":
        ext_tools: list[dict] = []
        tools = None
    else:
        ext_tools = await gather_mcp_tools(session, None) + await gather_openapi_tools(session, None)
        builtin: list[dict] = []
        if cfg.copilot_web_enabled and cfg.copilot_web_url:
            builtin.append(WEB_TOOL)
        if cfg.copilot_fs_enabled:
            builtin += FS_TOOLS
        tools = STATIC_TOOLS + builtin + [t["openai"] for t in ext_tools]
    skills = await gather_skills(session, None)
    system = conv.system_prompt + (f"\n\n=== Skills ===\n{skills}" if skills else "")
    return ext_tools, tools, system


def _apply_usage(conv: CopilotConversation, usage: dict) -> None:
    conv.tokens_total = (conv.tokens_total or 0) + int(usage.get("total_tokens") or 0)
    if usage.get("prompt_tokens"):
        conv.tokens_context = int(usage["prompt_tokens"])


async def advance(session: AsyncSession, conv: CopilotConversation, user: User) -> None:
    """Avança a conversa até uma resposta final ou uma ação pendente de aprovação."""
    llm = await _require_llm(session)  # LLM global (Super Admin)
    org_cfg = await integrations.get_or_create_settings(session, None)  # web/fs/tools GLOBAIS
    ext_tools, tools, system = await _tools_and_system(session, conv, org_cfg)

    for _ in range(MAX_ITERS):
        if await unanswered_tool_calls(session, conv):
            return  # bloqueado aguardando aprovação

        resp = await _chat(llm, _build_api_messages(system, await _messages(session, conv)), tools)
        msg = (resp.get("choices") or [{}])[0].get("message", {})
        content = msg.get("content") or ""
        tool_calls = msg.get("tool_calls") or []
        # Reasoning/thinking exposto por modelos de raciocínio (DeepSeek-R1 etc.).
        reasoning = msg.get("reasoning_content") or msg.get("reasoning")

        _apply_usage(conv, resp.get("usage") or {})

        session.add(CopilotMessage(
            conversation_id=conv.id, role="assistant", content=content,
            reasoning=reasoning, tool_calls=tool_calls or None,
        ))
        await session.flush()

        if not tool_calls:
            await session.commit()
            return  # resposta final

        for tc in tool_calls:
            await _process_tool_call(session, conv, user, tc, ext_tools, org_cfg)
        await session.commit()

        if await unanswered_tool_calls(session, conv):
            return  # há ação(ões) pendente(s)

    session.add(CopilotMessage(conversation_id=conv.id, role="assistant", content="(limite de iterações do Copilot atingido)"))
    await session.commit()


async def resume_action(session: AsyncSession, conv: CopilotConversation, action: CopilotAction, user: User, approve: bool) -> None:
    """Aprova (executa) ou rejeita uma ação pendente e continua o loop se possível."""
    if action.status != "pending":
        return
    if approve:
        d = await _device_for(session, conv, user, action.device_id or 0)
        if not d:
            action.status = "failed"
            action.output = "device indisponível"
            _add_tool_msg(session, conv, action.tool_call_id, "propose_write", "device indisponível")
        else:
            ok, out = await _exec_write(session, user, d, action.command)
            action.status = "executed" if ok else "failed"
            action.output = out[:8000]
            _add_tool_msg(session, conv, action.tool_call_id, "propose_write", f"[{'executado' if ok else 'falhou'}] {out}")
    else:
        action.status = "rejected"
        _add_tool_msg(session, conv, action.tool_call_id, "propose_write", "O operador REJEITOU este comando; não foi executado.")
    await session.commit()

    if not await unanswered_tool_calls(session, conv):
        await advance(session, conv, user)


# === Streaming (SSE) ===


async def _stream_llm(cfg, messages: list[dict], tools: list[dict] | None):
    """Async generator de eventos do LLM em streaming.

    Emite {"type":"delta"|"reasoning","text":...} conforme os tokens chegam e,
    ao final, {"type":"final","content","reasoning","tool_calls","usage"}.
    """
    base = (cfg.llm_base_url or "").rstrip("/")
    headers = {"Authorization": f"Bearer {decrypt(cfg.llm_api_key)}"} if cfg.llm_api_key else {}
    body: dict = {
        "model": cfg.llm_model, "messages": messages, "temperature": 0.2,
        "stream": True, "stream_options": {"include_usage": True},
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_calls: dict[int, dict] = {}
    usage: dict = {}
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", f"{base}/chat/completions", headers=headers, json=body) as r:
                if r.status_code >= 300:
                    detail = (await r.aread()).decode("utf-8", "replace")[:300]
                    raise CopilotError(f"LLM HTTP {r.status_code}: {detail}")
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("usage"):
                        usage = chunk["usage"]
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    if delta.get("content"):
                        content_parts.append(delta["content"])
                        yield {"type": "delta", "text": delta["content"]}
                    rc = delta.get("reasoning_content") or delta.get("reasoning")
                    if rc:
                        reasoning_parts.append(rc)
                        yield {"type": "reasoning", "text": rc}
                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0)
                        slot = tool_calls.setdefault(idx, {"id": None, "name": "", "args": ""})
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            slot["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["args"] += fn["arguments"]
    except CopilotError:
        raise
    except Exception as e:
        raise CopilotError(f"LLM inacessível: {type(e).__name__}: {e}")

    assembled = [
        {"id": v["id"] or f"call_{i}", "type": "function", "function": {"name": v["name"], "arguments": v["args"]}}
        for i, v in sorted(tool_calls.items())
    ]
    yield {"type": "final", "content": "".join(content_parts), "reasoning": ("".join(reasoning_parts) or None),
           "tool_calls": assembled, "usage": usage}


async def advance_stream(session: AsyncSession, conv: CopilotConversation, user: User):
    """Como advance(), mas gera eventos SSE: delta/reasoning/tool/suspended."""
    llm = await _require_llm(session)  # LLM global (Super Admin)
    org_cfg = await integrations.get_or_create_settings(session, None)  # web/fs/tools GLOBAIS
    ext_tools, tools, system = await _tools_and_system(session, conv, org_cfg)

    for _ in range(MAX_ITERS):
        if await unanswered_tool_calls(session, conv):
            yield {"type": "suspended"}
            return

        final = None
        async for ev in _stream_llm(llm, _build_api_messages(system, await _messages(session, conv)), tools):
            if ev["type"] in ("delta", "reasoning"):
                yield ev
            else:
                final = ev
        final = final or {"content": "", "reasoning": None, "tool_calls": [], "usage": {}}

        _apply_usage(conv, final["usage"])
        session.add(CopilotMessage(
            conversation_id=conv.id, role="assistant", content=final["content"],
            reasoning=final["reasoning"], tool_calls=final["tool_calls"] or None,
        ))
        await session.flush()

        if not final["tool_calls"]:
            await session.commit()
            yield {"type": "message_done"}
            return

        for tc in final["tool_calls"]:
            yield {"type": "tool", "name": tc.get("function", {}).get("name", "")}
            await _process_tool_call(session, conv, user, tc, ext_tools, org_cfg)
        await session.commit()

        if await unanswered_tool_calls(session, conv):
            yield {"type": "suspended"}
            return

    session.add(CopilotMessage(conversation_id=conv.id, role="assistant", content="(limite de iterações do Copilot atingido)"))
    await session.commit()
    yield {"type": "message_done"}
