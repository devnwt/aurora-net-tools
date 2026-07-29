"""Validação de documento fiscal do titular: CPF (pessoa física) ou CNPJ
(pessoa jurídica). Usado no cadastro do perfil e exigido antes do checkout.

Armazenamento canônico: sem pontuação, em maiúsculas. CPF = 11 dígitos. CNPJ = 14
caracteres: 12 alfanuméricos + 2 dígitos verificadores (o CNPJ alfanumérico entrou
em vigor em jul/2026; o cálculo do DV usa o valor ASCII de cada caractere menos 48,
o que é retrocompatível com o CNPJ 100% numérico).
"""

import re

_CNPJ_RE = re.compile(r"^[0-9A-Z]{12}[0-9]{2}$")


def normalize_document(value: str | None) -> str:
    """Remove pontuação e espaços, mantém letras/dígitos, em maiúsculas."""
    return re.sub(r"[^0-9A-Za-z]", "", value or "").upper()


def _cpf_valid(d: str) -> bool:
    if len(d) != 11 or not d.isdigit() or d == d[0] * 11:  # 11 dígitos, não repetidos
        return False
    for size in (9, 10):
        total = sum(int(d[i]) * ((size + 1) - i) for i in range(size))
        check = (total * 10) % 11 % 10
        if check != int(d[size]):
            return False
    return True


def _cnpj_valid(d: str) -> bool:
    # 14 caracteres: 12 alfanuméricos + 2 dígitos verificadores. DV pelo valor
    # ASCII-48 de cada caractere ('0'->0 ... '9'->9, 'A'->17 ... 'Z'->42).
    if not _CNPJ_RE.match(d) or d == d[0] * 14:
        return False
    weights2 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    weights1 = [6, *weights2]
    for weights, size in ((weights2, 12), (weights1, 13)):
        total = sum((ord(d[i]) - 48) * weights[i] for i in range(size))
        rest = total % 11
        check = 0 if rest < 2 else 11 - rest
        if check != int(d[size]):
            return False
    return True


def is_valid_document(value: str | None) -> bool:
    d = normalize_document(value)
    return _cpf_valid(d) or _cnpj_valid(d)


def format_document(value: str | None) -> str:
    """Formata para exibição/envio: CPF 000.000.000-00 ou CNPJ 00.000.000/0000-00
    (posicional, funciona também para o CNPJ alfanumérico). Fora de 11/14, devolve
    os caracteres sem formatar."""
    d = normalize_document(value)
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    return d


def document_error(value: str | None) -> str | None:
    """Mensagem de erro (pt-BR) se o documento for inválido; None se OK."""
    d = normalize_document(value)
    if len(d) not in (11, 14):
        return "documento deve ser um CPF (11 dígitos) ou CNPJ (14 caracteres)"
    if not is_valid_document(d):
        return "CPF/CNPJ inválido"
    return None
