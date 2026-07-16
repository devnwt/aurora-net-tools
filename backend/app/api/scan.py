from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.services import scan as scan_service

router = APIRouter(prefix="/scan", tags=["scan"], dependencies=[Depends(get_current_user)])


class ScanRequest(BaseModel):
    range: str
    username: str = "admin"
    password: str = ""
    ssh_port: int = 22


@router.post("")
async def run_scan(payload: ScanRequest):
    """Varre uma faixa de IPs em busca de RouterOS (TCP + auth SSH)."""
    try:
        return await scan_service.scan(payload.range, payload.username, payload.password, payload.ssh_port)
    except ValueError as e:
        raise HTTPException(400, str(e))
