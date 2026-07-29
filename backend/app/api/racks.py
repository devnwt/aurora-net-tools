"""Racks (Site → Rack → Device), ligações rack↔rack e o grafo da ORG."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import OrgFk, new_org_id, owned, require_org_fk, scope
from app.core.db import get_session
from app.models import Device, DeviceGroup, Rack, RackLink, User, UserGroup

router = APIRouter(tags=["racks"], dependencies=[Depends(get_current_user)])


# === Racks ===


class RackIn(BaseModel):
    site_id: int
    name: str
    description: str = ""


class RackPatch(BaseModel):
    site_id: int | None = None
    name: str | None = None
    description: str | None = None


def _rack(r: Rack) -> dict:
    return {"id": r.id, "site_id": r.site_id, "name": r.name, "description": r.description}


async def _get_rack(session: AsyncSession, rack_id: int, user: User) -> Rack:
    r = (await session.execute(select(Rack).where(Rack.id == rack_id))).scalar_one_or_none()
    return owned(r, user)


@router.get("/racks")
async def list_racks(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    site_id: int | None = Query(None),
):
    stmt = scope(select(Rack), Rack, user).order_by(Rack.name)
    if site_id is not None:
        stmt = stmt.where(Rack.site_id == site_id)
    return [_rack(r) for r in (await session.execute(stmt)).scalars().all()]


@router.post("/racks", status_code=201)
async def create_rack(payload: RackIn, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    org_id = new_org_id(user)
    await require_org_fk(session, org_id, OrgFk(DeviceGroup, payload.site_id))
    r = Rack(org_id=org_id, site_id=payload.site_id, name=payload.name, description=payload.description)
    session.add(r)
    await session.commit()
    await session.refresh(r)
    return _rack(r)


@router.patch("/racks/{rack_id}")
async def update_rack(rack_id: int, payload: RackPatch, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    r = await _get_rack(session, rack_id, user)
    data = payload.model_dump(exclude_unset=True)
    if "site_id" in data:
        await require_org_fk(session, r.org_id, OrgFk(DeviceGroup, data["site_id"]))
    for k, v in data.items():
        setattr(r, k, v)
    await session.commit()
    await session.refresh(r)
    return _rack(r)


@router.delete("/racks/{rack_id}", status_code=204)
async def delete_rack(rack_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    r = await _get_rack(session, rack_id, user)
    await session.delete(r)  # devices ficam sem rack (SET NULL); links removidos (CASCADE)
    await session.commit()


# === Rack links ===


class LinkIn(BaseModel):
    rack_a_id: int
    rack_b_id: int
    iface_a: str = ""
    iface_b: str = ""


def _link(l: RackLink) -> dict:
    return {"id": l.id, "rack_a_id": l.rack_a_id, "rack_b_id": l.rack_b_id, "iface_a": l.iface_a, "iface_b": l.iface_b}


@router.get("/rack-links")
async def list_links(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    rows = (await session.execute(scope(select(RackLink), RackLink, user))).scalars().all()
    return [_link(l) for l in rows]


@router.post("/rack-links", status_code=201)
async def create_link(payload: LinkIn, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    if payload.rack_a_id == payload.rack_b_id:
        raise HTTPException(400, "um link precisa ligar dois racks diferentes")
    await _get_rack(session, payload.rack_a_id, user)  # ambos da ORG
    await _get_rack(session, payload.rack_b_id, user)
    l = RackLink(
        org_id=new_org_id(user),
        rack_a_id=payload.rack_a_id,
        rack_b_id=payload.rack_b_id,
        iface_a=payload.iface_a,
        iface_b=payload.iface_b,
    )
    session.add(l)
    await session.commit()
    await session.refresh(l)
    return _link(l)


@router.delete("/rack-links/{link_id}", status_code=204)
async def delete_link(link_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    l = (await session.execute(select(RackLink).where(RackLink.id == link_id))).scalar_one_or_none()
    owned(l, user)
    await session.delete(l)
    await session.commit()


# === Grafo (Site → Rack → Device + links) ===


@router.get("/graph")
async def graph(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    sites = (await session.execute(scope(select(DeviceGroup), DeviceGroup, user))).scalars().all()
    racks = (await session.execute(scope(select(Rack), Rack, user))).scalars().all()
    devices = (await session.execute(scope(select(Device), Device, user))).scalars().all()
    links = (await session.execute(scope(select(RackLink), RackLink, user))).scalars().all()

    rack_by_id = {r.id: r for r in racks}
    nodes: list[dict] = []
    edges: list[dict] = []

    for s in sites:
        nodes.append({"id": f"site-{s.id}", "type": "site", "label": s.name})
    for r in racks:
        nodes.append({"id": f"rack-{r.id}", "type": "rack", "label": r.name})
        edges.append({"source": f"site-{r.site_id}", "target": f"rack-{r.id}", "kind": "contains"})
    for d in devices:
        nodes.append({"id": f"device-{d.id}", "type": "device", "label": d.name, "device_type": d.device_type.value})
        if d.rack_id and d.rack_id in rack_by_id:
            edges.append({"source": f"rack-{d.rack_id}", "target": f"device-{d.id}", "kind": "contains"})
        elif d.group_id:
            edges.append({"source": f"site-{d.group_id}", "target": f"device-{d.id}", "kind": "contains"})
    for l in links:
        if l.rack_a_id in rack_by_id and l.rack_b_id in rack_by_id:
            lbl = f"{l.iface_a or '?'} ↔ {l.iface_b or '?'}"
            edges.append({"source": f"rack-{l.rack_a_id}", "target": f"rack-{l.rack_b_id}", "kind": "link", "label": lbl})

    # Grupos de usuários + usuários (só para admin/master).
    if user.role in ("master", "admin"):
        ugroups = (await session.execute(scope(select(UserGroup), UserGroup, user))).scalars().all()
        members = (await session.execute(scope(select(User), User, user))).scalars().all()
        ug_ids = {g.id for g in ugroups}
        for g in ugroups:
            nodes.append({"id": f"ug-{g.id}", "type": "usergroup", "label": g.name})
            if g.parent_id and g.parent_id in ug_ids:
                edges.append({"source": f"ug-{g.parent_id}", "target": f"ug-{g.id}", "kind": "contains"})
        for u in members:
            nodes.append({"id": f"user-{u.id}", "type": "user", "label": u.username})
            if u.usergroup_id and u.usergroup_id in ug_ids:
                edges.append({"source": f"ug-{u.usergroup_id}", "target": f"user-{u.id}", "kind": "contains"})

    return {"nodes": nodes, "edges": edges}
