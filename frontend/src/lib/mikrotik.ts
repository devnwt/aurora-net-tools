// Helpers de apresentação para a gestão MikroTik (Dashboard / Devices / Detalhe).
// O estado ao vivo (online, board, RouterOS, CPU/RAM/temp/uptime) vem do poller,
// lido via `/devices/status` e consultado por `statusOf(map, id)`.
import type { Device, DeviceStatusInfo, Group } from "@/lib/types";

export type DeviceStatus = "online" | "not_accessible" | "offline" | "unknown" | "disabled";

type Tone = "ok" | "accent" | "danger" | "muted";

export const STATUS_META: Record<DeviceStatus, { label: string; tone: Tone; dot: string }> = {
  online: { label: "Online", tone: "ok", dot: "bg-ok" },
  not_accessible: { label: "Not accessible", tone: "accent", dot: "bg-accent" },
  offline: { label: "Offline", tone: "danger", dot: "bg-danger" },
  unknown: { label: "Unknown", tone: "muted", dot: "bg-muted" },
  disabled: { label: "Disabled", tone: "muted", dot: "bg-muted" },
};

export type StatusMap = Map<number, DeviceStatusInfo>;

export const toStatusMap = (rows: DeviceStatusInfo[]): StatusMap =>
  new Map(rows.map((r) => [r.device_id, r]));

/** Status do device a partir do snapshot do poller (default "unknown" se ainda não polido). */
export function statusOf(map: StatusMap, deviceId: number): DeviceStatus {
  return (map.get(deviceId)?.status as DeviceStatus) ?? "unknown";
}

/** Método de acesso primário, na ordem de preferência. "REST" = API HTTP do RouterOS. */
export function methodOf(d: Device): string {
  if (d.ssh_enabled) return "SSH";
  if (d.api_enabled) return "REST";
  if (d.snmp_enabled) return "SNMP";
  if (d.telnet_enabled) return "Telnet";
  return "—";
}

/** Todos os métodos habilitados (para os badges do cabeçalho do detalhe). */
export function methodsOf(d: Device): string[] {
  const m: string[] = [];
  if (d.ssh_enabled) m.push("SSH");
  if (d.api_enabled) m.push("REST");
  if (d.snmp_enabled) m.push("SNMP");
  if (d.telnet_enabled) m.push("Telnet");
  return m;
}

export interface SiteGroup {
  id: number | null;
  name: string;
  devices: Device[];
}

/** Agrupa devices por site (group). Devices sem site caem em "Sem site". */
export function groupBySite(devices: Device[], groups: Group[]): SiteGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g.name]));
  const buckets = new Map<number | null, Device[]>();
  for (const d of devices) {
    const key = d.group_id ?? null;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(d);
  }
  const out: SiteGroup[] = [];
  for (const [id, devs] of buckets) {
    out.push({ id, name: id === null ? "Sem site" : byId.get(id) ?? `Site ${id}`, devices: devs });
  }
  return out;
}
