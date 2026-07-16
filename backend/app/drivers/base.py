class DriverError(Exception):
    """Falha ao acessar/executar em um equipamento."""


class WriteBlocked(Exception):
    """Comando de escrita recusado no MVP read-only (decisão §4/§13)."""
