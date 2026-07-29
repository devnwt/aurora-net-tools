"""Resolução de credencial: device → grupo → erro (decisão §7)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Credential, Device, DeviceGroup
from app.models.enums import Protocol

_DEVICE_FK = {
    Protocol.ssh: "ssh_credential_id",
    Protocol.telnet: "telnet_credential_id",
    Protocol.snmp: "snmp_credential_id",
}
_GROUP_DEFAULT_FK = {
    Protocol.ssh: "default_ssh_credential_id",
    Protocol.telnet: "default_telnet_credential_id",
    Protocol.snmp: "default_snmp_credential_id",
}


class CredentialNotFound(Exception):
    pass


def _same_org(a_org_id: int | None, b_org_id: int | None) -> bool:
    return a_org_id == b_org_id


async def resolve_credential(
    session: AsyncSession, device: Device, protocol: Protocol
) -> Credential:
    """Retorna a credencial efetiva do device para o protocolo.

    Ordem: credencial própria do device → padrão do grupo → erro claro.
    Só aceita credencial (e grupo) da mesma ORG do device — defesa contra
    FKs cross-tenant já gravados ou bypass de API.
    """
    cred_id = getattr(device, _DEVICE_FK[protocol], None)

    if cred_id is None and device.group_id is not None:
        group = (
            await session.execute(
                select(DeviceGroup).where(DeviceGroup.id == device.group_id)
            )
        ).scalar_one_or_none()
        if group is not None and _same_org(group.org_id, device.org_id):
            cred_id = getattr(group, _GROUP_DEFAULT_FK[protocol], None)

    if cred_id is None:
        raise CredentialNotFound(
            f"nenhuma credencial {protocol.value} definida para o device '{device.name}' "
            f"(nem no device nem no grupo)"
        )

    cred = (
        await session.execute(select(Credential).where(Credential.id == cred_id))
    ).scalar_one_or_none()
    if cred is None or not _same_org(cred.org_id, device.org_id):
        raise CredentialNotFound(
            f"credencial id={cred_id} indisponível para o device '{device.name}'"
        )
    return cred
