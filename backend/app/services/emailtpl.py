"""Template HTML dos e-mails transacionais da Aurora Prisma NetTools.

Layout formal e simples: cabeçalho PRETO com a marca (logo colorido + ícone),
corpo BRANCO com o conteúdo, rodapé PRETO. Um código de confirmação, quando há,
aparece grande, centralizado e em negrito. Tudo com estilos inline e tabelas
(compatível com a maioria dos clientes de e-mail).
"""

import html as _html
from pathlib import Path

_BG = "#0b0f14"          # preto do cabeçalho/rodapé
_INK = "#0f172a"         # texto escuro (corpo branco)
_MUTED = "#64748b"       # texto secundário
_BLUE = "#3b82f6"
_BLUE_LT = "#60a5fa"     # "NetTools" sobre o preto

# Ícone da marca embutido no e-mail como anexo inline (CID) — funciona no Gmail/
# Apple Mail/Outlook, diferente de data-URI (que o Gmail bloqueia).
LOGO_CID = "auroralogo"
_LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "email-logo.png"


def logo_bytes() -> bytes | None:
    """Bytes do PNG do logo para anexar por CID (None se ausente)."""
    try:
        return _LOGO_PATH.read_bytes()
    except OSError:
        return None


def _esc(s: str) -> str:
    return _html.escape(s or "")


def _logo() -> str:
    # Ícone real (favicon) via CID; se o arquivo não existir, cai no "A" gradiente.
    if _LOGO_PATH.exists():
        icon = (
            f'<img src="cid:{LOGO_CID}" width="40" height="40" alt="Aurora Prisma NetTools" '
            'style="display:inline-block;border-radius:10px;vertical-align:middle;">'
        )
    else:
        icon = (
            '<div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#3b82f6,#f59e0b);'
            'text-align:center;line-height:40px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:20px;">A</div>'
        )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">'
        '<tr>'
        f'<td style="vertical-align:middle;padding-right:11px;">{icon}</td>'
        '<td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:700;color:#ffffff;letter-spacing:.2px;">'
        f'Aurora&nbsp;Prisma <span style="color:{_BLUE_LT};">NetTools</span>'
        '</td>'
        '</tr></table>'
    )


def render(
    *,
    heading: str,
    intro: str,
    code: str | None = None,
    button_label: str | None = None,
    button_url: str | None = None,
    note: str | None = None,
) -> str:
    """Monta o HTML do e-mail. `intro` e `note` aceitam quebras com \\n."""
    intro_html = _esc(intro).replace("\n", "<br>")

    code_block = ""
    if code:
        code_block = (
            '<div style="margin:28px 0;text-align:center;">'
            '<div style="display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;'
            'padding:18px 30px;font-family:\'Courier New\',Courier,monospace;font-size:36px;font-weight:800;'
            f'letter-spacing:12px;color:{_INK};">{_esc(code)}</div>'
            '</div>'
        )

    button_block = ""
    if button_label and button_url:
        button_block = (
            '<div style="margin:28px 0;text-align:center;">'
            f'<a href="{_esc(button_url)}" target="_blank" style="display:inline-block;background:{_BLUE};color:#ffffff;'
            'text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:15px;'
            f'padding:13px 32px;border-radius:10px;">{_esc(button_label)}</a></div>'
        )

    note_block = ""
    if note:
        note_html = _esc(note).replace("\n", "<br>")
        note_block = (
            f'<p style="margin:20px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:{_MUTED};">'
            f'{note_html}</p>'
        )

    return (
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        # Trava o esquema de cor em CLARO: impede o cliente (Gmail/Apple Mail no
        # dark mode) de escurecer o corpo branco.
        '<meta name="color-scheme" content="light">'
        '<meta name="supported-color-schemes" content="light">'
        '<style>:root{color-scheme:light;supported-color-schemes:light;}</style>'
        '</head>'
        f'<body style="margin:0;padding:0;background:{_BG};">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_BG};padding:28px 12px;border-collapse:collapse;">'
        '<tr><td align="center">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        'style="max-width:600px;width:100%;border-collapse:collapse;border-radius:16px;overflow:hidden;">'
        # --- Cabeçalho PRETO com a marca ---
        f'<tr><td style="background:{_BG};padding:26px 30px;text-align:center;border-bottom:1px solid rgba(255,255,255,.06);">'
        f'{_logo()}</td></tr>'
        # --- Corpo BRANCO ---
        '<tr><td style="background:#ffffff;padding:36px 34px 30px;">'
        f'<h1 style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:{_INK};">{_esc(heading)}</h1>'
        f'<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#334155;">{intro_html}</p>'
        f'{code_block}{button_block}{note_block}'
        '</td></tr>'
        # --- Rodapé PRETO ---
        f'<tr><td style="background:{_BG};padding:22px 30px;text-align:center;">'
        f'<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:{_MUTED};">'
        'Aurora Prisma NetTools · mensagem automática, não responda a este e-mail.'
        '</p></td></tr>'
        '</table></td></tr></table></body></html>'
    )
