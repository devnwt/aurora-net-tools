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


async def resolve_credential(
    session: AsyncSession, device: Device, protocol: Protocol
) -> Credential:
    """Retorna a credencial efetiva do device para o protocolo.

    Ordem: credencial própria do device → padrão do grupo → erro claro.
    """
    cred_id = getattr(device, _DEVICE_FK[protocol], None)

    if cred_id is None and device.group_id is not None:
        group = (
            await session.execute(
                select(DeviceGroup).where(DeviceGroup.id == device.group_id)
            )
        ).scalar_one_or_none()
        if group is not None:
            cred_id = getattr(group, _GROUP_DEFAULT_FK[protocol], None)

    if cred_id is None:
        raise CredentialNotFound(
            f"nenhuma credencial {protocol.value} definida para o device '{device.name}' "
            f"(nem no device nem no grupo)"
        )

    cred = (
        await session.execute(select(Credential).where(Credential.id == cred_id))
    ).scalar_one_or_none()
    if cred is None:
        raise CredentialNotFound(f"credencial id={cred_id} não existe")
    return cred
