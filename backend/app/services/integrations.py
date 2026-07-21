"""Testes e envios das integrações por ORG: SMTP, FTP, LLM e MinIO/S3.

Cada helper faz uma operação real e retorna (ok, detalhe). As chamadas
bloqueantes (smtplib/ftplib/boto3) rodam num threadpool; o LLM usa httpx async.
"""

from __future__ import annotations

import ftplib
import io
import smtplib
import ssl
from email.message import EmailMessage

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import OrgSettings


async def get_settings(session: AsyncSession, org_id: int | None) -> OrgSettings | None:
    """Linha de integrações da ORG (ou None se ainda não configurada)."""
    return (await session.execute(select(OrgSettings).where(OrgSettings.org_id == org_id))).scalar_one_or_none()


async def get_or_create_settings(session: AsyncSession, org_id: int | None) -> OrgSettings:
    row = await get_settings(session, org_id)
    if row is None:
        row = OrgSettings(org_id=org_id)
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


async def send_email(cfg: OrgSettings, password: str, to: str, subject: str, body: str) -> tuple[bool, str]:
    """Envia um e-mail via SMTP configurado. (ok, detalhe)."""
    import asyncio

    def _run() -> tuple[bool, str]:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = cfg.smtp_from or cfg.smtp_username
            msg["To"] = to
            msg.set_content(body)
            if cfg.smtp_use_tls:
                with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=15) as s:
                    s.starttls(context=ssl.create_default_context())
                    if cfg.smtp_username:
                        s.login(cfg.smtp_username, password)
                    s.send_message(msg)
            else:
                with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=15) as s:
                    if cfg.smtp_username:
                        s.login(cfg.smtp_username, password)
                    s.send_message(msg)
            return True, f"E-mail enviado para {to}."
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"

    return await asyncio.to_thread(_run)


async def smtp_test(cfg: OrgSettings, password: str, to: str) -> tuple[bool, str]:
    return await send_email(
        cfg, password, to,
        "Aurora Prisma NetTools — teste de SMTP",
        "Este é um e-mail de teste enviado pela Aurora Prisma NetTools.",
    )


async def ftp_test(cfg: OrgSettings, password: str) -> tuple[bool, str]:
    import asyncio

    def _run() -> tuple[bool, str]:
        try:
            ftp: ftplib.FTP = ftplib.FTP_TLS() if cfg.ftp_use_tls else ftplib.FTP()
            ftp.connect(cfg.ftp_host, cfg.ftp_port or 21, timeout=15)
            ftp.login(cfg.ftp_username or "anonymous", password or "")
            if isinstance(ftp, ftplib.FTP_TLS):
                ftp.prot_p()
            if cfg.ftp_path:
                ftp.cwd(cfg.ftp_path)
            pwd = ftp.pwd()
            ftp.quit()
            return True, f"Conectado. Diretório atual: {pwd}"
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"

    return await asyncio.to_thread(_run)


async def ftp_upload(cfg: OrgSettings, password: str, filename: str, data: bytes) -> tuple[bool, str]:
    import asyncio

    def _run() -> tuple[bool, str]:
        try:
            ftp: ftplib.FTP = ftplib.FTP_TLS() if cfg.ftp_use_tls else ftplib.FTP()
            ftp.connect(cfg.ftp_host, cfg.ftp_port or 21, timeout=30)
            ftp.login(cfg.ftp_username or "anonymous", password or "")
            if isinstance(ftp, ftplib.FTP_TLS):
                ftp.prot_p()
            if cfg.ftp_path:
                ftp.cwd(cfg.ftp_path)
            ftp.storbinary(f"STOR {filename}", io.BytesIO(data))
            ftp.quit()
            where = f"{cfg.ftp_host}:{cfg.ftp_port or 21}{'/' + cfg.ftp_path.strip('/') if cfg.ftp_path else ''}/{filename}"
            return True, f"enviado por FTP → {where}"
        except Exception as e:
            return False, f"FTP: {type(e).__name__}: {e}"

    return await asyncio.to_thread(_run)


# --- MinIO / S3 -----------------------------------------------------------


def _s3_endpoint(cfg: OrgSettings) -> str:
    ep = (cfg.s3_endpoint or "").strip()
    if ep.startswith("http://") or ep.startswith("https://"):
        return ep
    return f"{'https' if cfg.s3_use_ssl else 'http'}://{ep}"


def _s3_client(cfg: OrgSettings, secret_key: str):
    import boto3
    from botocore.client import Config

    # path-style + s3v4: exigido pelo MinIO e compatível com S3.
    return boto3.client(
        "s3",
        endpoint_url=_s3_endpoint(cfg),
        aws_access_key_id=cfg.s3_access_key,
        aws_secret_access_key=secret_key,
        region_name=cfg.s3_region or "us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _s3_key(cfg: OrgSettings, filename: str) -> str:
    prefix = (cfg.s3_prefix or "").strip().strip("/")
    return f"{prefix}/{filename}" if prefix else filename


async def s3_test(cfg: OrgSettings, secret_key: str) -> tuple[bool, str]:
    import asyncio

    def _run() -> tuple[bool, str]:
        try:
            if not cfg.s3_bucket:
                return False, "bucket não configurado"
            _s3_client(cfg, secret_key).head_bucket(Bucket=cfg.s3_bucket)
            return True, f"bucket '{cfg.s3_bucket}' acessível em {_s3_endpoint(cfg)}"
        except Exception as e:
            return False, f"S3: {type(e).__name__}: {e}"

    return await asyncio.to_thread(_run)


async def s3_upload(cfg: OrgSettings, secret_key: str, filename: str, data: bytes) -> tuple[bool, str]:
    import asyncio

    def _run() -> tuple[bool, str]:
        try:
            key = _s3_key(cfg, filename)
            _s3_client(cfg, secret_key).put_object(
                Bucket=cfg.s3_bucket, Key=key, Body=data, ContentType="text/plain"
            )
            return True, f"enviado por S3 → s3://{cfg.s3_bucket}/{key}"
        except Exception as e:
            return False, f"S3: {type(e).__name__}: {e}"

    return await asyncio.to_thread(_run)


async def llm_test(cfg: OrgSettings, api_key: str) -> tuple[bool, str]:
    base = (cfg.llm_base_url or "").rstrip("/")
    if not base:
        return False, "base URL não configurada"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            # Chat completion mínima — compatível com a API da OpenAI e derivados.
            r = await client.post(
                f"{base}/chat/completions",
                headers=headers,
                json={
                    "model": cfg.llm_model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 5,
                },
            )
            if r.status_code < 300:
                return True, f"OK — modelo '{cfg.llm_model}' respondeu (HTTP {r.status_code})."
            return False, f"HTTP {r.status_code}: {r.text[:300]}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
