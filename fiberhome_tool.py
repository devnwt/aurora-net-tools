"""
title: Fiberhome ONU Tool
author: NOC
description: Consulta ONUs Fiberhome por nome de cliente ou MAC address, com dados em tempo real via UNM2000.
version: 0.1.0
"""

from datetime import datetime
from typing import Optional

import httpx
from pydantic import BaseModel, Field


def _fmt_date(value: str) -> str:
    """Converte data ISO ou 'YYYY-MM-DD HH:MM:SS' para formato brasileiro."""
    if not value or value in ("--", ""):
        return "—"
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(value[:19], fmt[:len(fmt)]).strftime("%d/%m/%Y %H:%M:%S")
        except ValueError:
            continue
    return value


def _fmt_signal(value) -> str:
    if value is None:
        return "—"
    return f"{value:.2f} dBm"


def _fmt_onu(data: dict) -> str:
    rt = data.get("realtime", {})

    lan_lines = ""
    for port in rt.get("lan_ports", []):
        port_id = port.get("port") or "—"
        status = "conectada" if port.get("connected") else "desconectada"
        speed = port.get("speed", "")
        speed_str = f" ({speed})" if speed and speed not in ("--", "") else ""
        lan_lines += f"\n  {port_id} → {status}{speed_str}"

    if rt.get("from_cache") and rt.get("cached_at"):
        fonte = f"cache do sync ({_fmt_date(rt['cached_at'])})"
    else:
        fonte = "tempo real"

    return (
        f"ONU encontrada: {data.get('loid') or data.get('mac')}\n"
        f"MAC: {data.get('mac', '—')}  |  Tipo: {data.get('onu_type', '—')}\n"
        f"OLT: {data.get('olt_name', '—')} ({data.get('olt_ip', '—')})  |  PON: {data.get('ponid', '—')}\n"
        f"\n"
        f"Estado Administrativo : {rt.get('state') or '—'}\n"
        f"Estado Operacional    : {rt.get('oper_state') or '—'}\n"
        f"Sinal RX              : {_fmt_signal(rt.get('rx_signal_dbm'))}\n"
        f"Última queda          : {_fmt_date(rt.get('last_offline', ''))}\n"
        f"Dados de estado       : {fonte}\n"
        f"Sincronizado em       : {_fmt_date(str(data.get('synced_at', '')))}\n"
        f"\nPortas LAN:{lan_lines if lan_lines else chr(10) + '  —'}"
    )


def _fmt_multiple(results: list, query: str) -> str:
    lines = "\n".join(
        f"  {i + 1}. {r.get('loid') or '—'}  —  MAC: {r.get('mac', '—')}  —  OLT: {r.get('olt_name', '—')}"
        for i, r in enumerate(results)
    )
    return (
        f"Encontrei {len(results)} ONUs com \"{query}\":\n"
        f"{lines}\n\n"
        f"Por favor, seja mais específico para que eu possa buscar os dados em tempo real."
    )


class Tools:
    class Valves(BaseModel):
        FIBERHOME_API_URL: str = Field(
            default="http://localhost:20000",
            description="URL base da Fiberhome Sync API",
        )

    def __init__(self):
        self.valves = self.Valves()

    async def buscar_onu_por_nome(self, nome: str, __event_emitter__=None) -> str:
        """
        Busca uma ONU pelo nome do cliente. Use quando o usuário mencionar o nome de um cliente.
        Realiza busca parcial — não é necessário digitar o nome completo.
        Retorna dados em tempo real: sinal óptico, estado, portas LAN e última queda.

        :param nome: Nome do cliente ou parte do nome (ex: "SEBASTIAO RIBEIRO" ou "SEBASTIAO")
        :return: Dados da ONU com informações em tempo real, ou lista de correspondências se houver mais de uma.
        """
        if __event_emitter__:
            await __event_emitter__({"type": "status", "data": {"description": "Consultando UNM2000 em tempo real, aguarde...", "done": False}})

        url = f"{self.valves.FIBERHOME_API_URL}/search"
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(url, params={"q": nome, "by": "name", "mode": "partial"})
        except httpx.ConnectError:
            return "Não foi possível conectar à API Fiberhome. Verifique se o serviço está rodando."
        except httpx.TimeoutException:
            return "A consulta demorou demais. O UNM2000 pode estar lento — tente novamente."

        if resp.status_code == 404:
            if __event_emitter__:
                await __event_emitter__({"type": "status", "data": {"description": "Concluído.", "done": True}})
            return f"Nenhuma ONU encontrada com o nome \"{nome}\"."

        if resp.status_code != 200:
            if __event_emitter__:
                await __event_emitter__({"type": "status", "data": {"description": "Concluído.", "done": True}})
            return f"Erro ao consultar a API: HTTP {resp.status_code}."

        data = resp.json()

        if __event_emitter__:
            await __event_emitter__({"type": "status", "data": {"description": "Concluído.", "done": True}})

        if isinstance(data, list):
            return _fmt_multiple(data, nome)

        if "realtime" in data and "error" in data.get("realtime", {}):
            return (
                f"ONU encontrada no banco de dados, mas não foi possível obter dados em tempo real:\n"
                f"{_fmt_onu({**data, 'realtime': {}})}\n\n"
                f"Erro ao contatar UNM2000: {data['realtime']['error']}"
            )

        return _fmt_onu(data)

    async def buscar_onu_por_mac(self, mac: str, __event_emitter__=None) -> str:
        """
        Busca uma ONU pelo endereço MAC. Use quando o usuário informar um MAC address ou identificador de ONU.
        Identificadores Fiberhome geralmente começam com 'TPLG' seguido de caracteres hexadecimais.
        Retorna dados em tempo real: sinal óptico, estado, portas LAN e última queda.

        :param mac: Endereço MAC ou identificador da ONU (ex: "TPLG897a5528")
        :return: Dados da ONU com informações em tempo real.
        """
        if __event_emitter__:
            await __event_emitter__({"type": "status", "data": {"description": "Consultando UNM2000 em tempo real, aguarde...", "done": False}})

        url = f"{self.valves.FIBERHOME_API_URL}/search"
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(url, params={"q": mac, "by": "mac"})
        except httpx.ConnectError:
            if __event_emitter__:
                await __event_emitter__({"type": "status", "data": {"description": "Concluído.", "done": True}})
            return "Não foi possível conectar à API Fiberhome. Verifique se o serviço está rodando."
        except httpx.TimeoutException:
            if __event_emitter__:
                await __event_emitter__({"type": "status", "data": {"description": "Concluído.", "done": True}})
            return "A consulta demorou demais. O UNM2000 pode estar lento — tente novamente."

        if resp.status_code == 404:
            if __event_emitter__:
                await __event_emitter__({"type": "status", "data": {"description": "Concluído.", "done": True}})
            return f"Nenhuma ONU encontrada com o MAC \"{mac}\"."

        if resp.status_code != 200:
            if __event_emitter__:
                await __event_emitter__({"type": "status", "data": {"description": "Concluído.", "done": True}})
            return f"Erro ao consultar a API: HTTP {resp.status_code}."

        data = resp.json()

        if __event_emitter__:
            await __event_emitter__({"type": "status", "data": {"description": "Concluído.", "done": True}})

        if "realtime" in data and "error" in data.get("realtime", {}):
            return (
                f"ONU encontrada no banco de dados, mas não foi possível obter dados em tempo real:\n"
                f"{_fmt_onu({**data, 'realtime': {}})}\n\n"
                f"Erro ao contatar UNM2000: {data['realtime']['error']}"
            )

        return _fmt_onu(data)

    async def status_sistema(self) -> str:
        """
        Verifica o status do sistema de sincronização com o UNM2000.
        Mostra quais OLTs estão sendo monitoradas, quantas ONUs foram sincronizadas e quando foi o último sync.
        Use quando o usuário perguntar se o sistema está funcionando ou se os dados estão atualizados.

        :return: Status de sincronização por OLT com timestamp em formato brasileiro.
        """
        url = f"{self.valves.FIBERHOME_API_URL}/sync/status"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url)
        except httpx.ConnectError:
            return "Não foi possível conectar à API Fiberhome. Verifique se o serviço está rodando."
        except httpx.TimeoutException:
            return "A API não respondeu a tempo."

        if resp.status_code != 200:
            return f"Erro ao consultar status: HTTP {resp.status_code}."

        items = resp.json()
        if not items:
            return "Nenhum sync realizado ainda. O sistema pode estar iniciando."

        lines = []
        for item in items:
            status = item.get("status", "")
            icon = "✓" if status == "ok" else "✗"
            nome = item.get("olt_name", item.get("olt_ip", "—"))
            count = item.get("onu_count", 0)
            ts = _fmt_date(str(item.get("last_sync_at", "")))
            if status == "ok":
                lines.append(f"  {icon} {nome:<22} — {count} ONUs — sincronizado em {ts}")
            else:
                erro = item.get("error") or "erro desconhecido"
                lines.append(f"  {icon} {nome:<22} — ERRO: {erro}")

        return "Status do Sync:\n" + "\n".join(lines)
