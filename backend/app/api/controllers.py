from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import OrgFk, new_org_id, owned, require_org_fk, scope
from app.core.db import get_session
from app.drivers import fiberhome
from app.drivers.base import DriverError
from app.models import Controller, Credential, User
from app.schemas.controller import ControllerCreate, ControllerOut, ControllerUpdate
from app.services.cache import cached

router = APIRouter(prefix="/controllers", tags=["controllers"], dependencies=[Depends(get_current_user)])

ONUS_CACHE_TTL = 60
# Recursos estruturais (lista de OLTs, info da OLT, placas, shelves, PONs) raramente
# mudam → TTL maior. Os de estado (ONUs/estados/não-registradas/alarmes) ficam curtos.
STRUCT_CACHE_TTL = 600


async def _credential(session: AsyncSession, controller: Controller) -> Credential | None:
    """Credencial do controller — só da mesma ORG (defesa em profundidade)."""
    if controller.credential_id is None:
        return None
    cred = (
        await session.execute(select(Credential).where(Credential.id == controller.credential_id))
    ).scalar_one_or_none()
    if cred is None or cred.org_id != controller.org_id:
        return None
    return cred


async def _get(session: AsyncSession, controller_id: int, user: User) -> Controller:
    c = (await session.execute(select(Controller).where(Controller.id == controller_id))).scalar_one_or_none()
    return owned(c, user)


@router.get("", response_model=list[ControllerOut])
async def list_controllers(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return (await session.execute(scope(select(Controller), Controller, user).order_by(Controller.name))).scalars().all()


@router.post("", response_model=ControllerOut, status_code=201)
async def create_controller(payload: ControllerCreate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    org_id = new_org_id(user)
    data = payload.model_dump()
    await require_org_fk(session, org_id, OrgFk(Credential, data.get("credential_id")))
    c = Controller(org_id=org_id, **data)
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return c


@router.get("/{controller_id}", response_model=ControllerOut)
async def get_controller(controller_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _get(session, controller_id, user)


@router.patch("/{controller_id}", response_model=ControllerOut)
async def update_controller(controller_id: int, payload: ControllerUpdate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get(session, controller_id, user)
    data = payload.model_dump(exclude_unset=True)
    if "credential_id" in data:
        await require_org_fk(session, c.org_id, OrgFk(Credential, data["credential_id"]))
    for k, v in data.items():
        setattr(c, k, v)
    await session.commit()
    await session.refresh(c)
    return c


@router.delete("/{controller_id}", status_code=204)
async def delete_controller(controller_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get(session, controller_id, user)
    await session.delete(c)
    await session.commit()


# === Fiberhome ao vivo via TL1 (Sprint 3) ===


async def _run(producer, cache_key: str | None = None, ttl: int = 0):
    """Executa um producer TL1, opcionalmente com cache, mapeando DriverError -> 502."""
    try:
        if cache_key:
            return await cached(cache_key, ttl, producer)
        return await producer()
    except DriverError as e:
        raise HTTPException(502, str(e))


# --- Nível OLT ---


@router.get("/{controller_id}/olts")
async def list_olts(controller_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fiberhome.list_olts(c, cred), f"fh:olts:{c.id}", STRUCT_CACHE_TTL)
    return {"ok": True, "controller": c.name, "olts": data}


@router.get("/{controller_id}/olts/{olt_ip}")
async def olt_info(controller_id: int, olt_ip: str, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fiberhome.olt_info(c, cred, olt_ip), f"fh:olt:{c.id}:{olt_ip}", STRUCT_CACHE_TTL)
    return {"ok": True, "controller": c.name, "olt": olt_ip, "info": data}


@router.get("/{controller_id}/olts/{olt_ip}/boards")
async def olt_boards(controller_id: int, olt_ip: str, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fiberhome.olt_boards(c, cred, olt_ip), f"fh:boards:{c.id}:{olt_ip}", STRUCT_CACHE_TTL)
    return {"ok": True, "controller": c.name, "olt": olt_ip, "boards": data}


@router.get("/{controller_id}/olts/{olt_ip}/shelves")
async def olt_shelves(controller_id: int, olt_ip: str, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fiberhome.olt_shelves(c, cred, olt_ip), f"fh:shelves:{c.id}:{olt_ip}", STRUCT_CACHE_TTL)
    return {"ok": True, "controller": c.name, "olt": olt_ip, "shelves": data}


@router.get("/{controller_id}/olts/{olt_ip}/pons")
async def list_pons(
    controller_id: int, olt_ip: str, ponid: str | None = None, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    key = f"fh:pons:{c.id}:{olt_ip}:{ponid or 'all'}"
    data = await _run(lambda: fiberhome.list_pons(c, cred, olt_ip, ponid), key, STRUCT_CACHE_TTL)
    return {"ok": True, "controller": c.name, "olt": olt_ip, "ponid": ponid, "pons": data}


@router.get("/{controller_id}/olts/{olt_ip}/onus")
async def list_onus(
    controller_id: int, olt_ip: str, ponid: str | None = None, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    key = f"fh:onus:{c.id}:{olt_ip}:{ponid or 'all'}"
    data = await _run(lambda: fiberhome.list_onus(c, cred, olt_ip, ponid), key, ONUS_CACHE_TTL)
    return {"ok": True, "controller": c.name, "olt": olt_ip, "ponid": ponid, "onus": data}


@router.get("/{controller_id}/olts/{olt_ip}/onu-states")
async def onu_states(controller_id: int, olt_ip: str, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fiberhome.onu_states(c, cred, olt_ip), f"fh:states:{c.id}:{olt_ip}", ONUS_CACHE_TTL)
    return {"ok": True, "controller": c.name, "olt": olt_ip, "states": data}


@router.get("/{controller_id}/olts/{olt_ip}/unregistered")
async def unregistered(controller_id: int, olt_ip: str, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fiberhome.onu_unregistered(c, cred, olt_ip), f"fh:unreg:{c.id}:{olt_ip}", ONUS_CACHE_TTL)
    return {"ok": True, "controller": c.name, "olt": olt_ip, "unregistered": data}


@router.get("/{controller_id}/olts/{olt_ip}/alarms")
async def olt_alarms(
    controller_id: int,
    olt_ip: str,
    start: str | None = None,
    end: str | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fiberhome.olt_alarms(c, cred, olt_ip, start, end))  # ao vivo, sem cache
    return {"ok": True, "controller": c.name, "olt": olt_ip, "alarms": data}


# --- Nível ONU (diagnóstico ao vivo, sem cache) ---

# Mapa de detalhes uniformes (assinatura olt_ip, ponid, onuid, onutype).
_ONU_DETAIL = {
    "state": fiberhome.onu_state,
    "optical": fiberhome.onu_optical,
    "info": fiberhome.onu_info,
    "lan": fiberhome.onu_lan,
    "config": fiberhome.onu_config,
    "wan": fiberhome.onu_wan,
    "macs": fiberhome.onu_macaddress,
    "laninfo": fiberhome.onu_laninfo,
    "service": fiberhome.onu_service,
}


@router.get("/{controller_id}/olts/{olt_ip}/onu/locate")
async def locate_onu(
    controller_id: int,
    olt_ip: str,
    onuid: str,
    onutype: str = "MAC",
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Localiza uma ONU pelo ID (descobre slot/PON) e consolida estado, sinal, info, LAN, config e MAC."""
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fiberhome.locate_onu(c, cred, olt_ip, onuid, onutype))
    return {"ok": True, "controller": c.name, "olt": olt_ip, "onuid": onuid, "onu": data}


@router.get("/{controller_id}/olts/{olt_ip}/onu/portvlan")
async def onu_portvlan(
    controller_id: int,
    olt_ip: str,
    onuid: str,
    ponid: str,
    onutype: str = "MAC",
    onuport: str | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fiberhome.onu_portvlan(c, cred, olt_ip, ponid, onuid, onutype, onuport))
    return {"ok": True, "controller": c.name, "olt": olt_ip, "onuid": onuid, "portvlan": data}


@router.get("/{controller_id}/olts/{olt_ip}/onu/{detail}")
async def onu_detail(
    controller_id: int,
    olt_ip: str,
    detail: str,
    onuid: str,
    ponid: str,
    onutype: str = "MAC",
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Detalhe de uma ONU: state | optical | info | lan | config | wan | macs | laninfo | service."""
    fn = _ONU_DETAIL.get(detail)
    if fn is None:
        raise HTTPException(404, f"detalhe de ONU inválido: {detail}")
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    data = await _run(lambda: fn(c, cred, olt_ip, ponid, onuid, onutype))
    return {"ok": True, "controller": c.name, "olt": olt_ip, "onuid": onuid, "detail": detail, "data": data}


@router.post("/{controller_id}/test")
async def test_controller(controller_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    c = await _get(session, controller_id, user)
    cred = await _credential(session, c)
    try:
        await fiberhome.call(c, cred, lambda tl1: True)
    except DriverError as e:
        raise HTTPException(502, str(e))
    return {"ok": True, "controller": c.name, "host": c.host, "port": c.port}
