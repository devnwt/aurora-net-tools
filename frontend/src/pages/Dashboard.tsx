import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { Device, DeviceStatusInfo, Group } from "@/lib/types";
import { groupBySite, methodOf, statusOf, STATUS_META, toStatusMap, type DeviceStatus, type StatusMap } from "@/lib/mikrotik";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const STAT_CARDS: { key: DeviceStatus | "total" | "sites"; label: string; color: string }[] = [
  { key: "total", label: "Total Devices", color: "text-text" },
  { key: "online", label: "Online", color: "text-ok" },
  { key: "not_accessible", label: "Not accessible", color: "text-accent" },
  { key: "offline", label: "Offline", color: "text-danger" },
  { key: "unknown", label: "Unknown", color: "text-muted" },
  { key: "sites", label: "Sites", color: "text-primary" },
];

export function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [statuses, setStatuses] = useState<StatusMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<"az" | "count">("az");

  function load() {
    setLoading(true);
    Promise.all([
      api.get<Device[]>("/devices"),
      api.get<Group[]>("/groups"),
      api.get<DeviceStatusInfo[]>("/devices/status"),
    ])
      .then(([d, g, s]) => {
        setDevices(d);
        setGroups(g);
        setStatuses(toStatusMap(s));
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { online: 0, not_accessible: 0, offline: 0, unknown: 0, disabled: 0 };
    for (const d of devices) c[statusOf(statuses, d.id)]++;
    return c;
  }, [devices, statuses]);

  const sites = useMemo(() => {
    const list = groupBySite(devices, groups);
    list.sort((a, b) => (order === "az" ? a.name.localeCompare(b.name) : b.devices.length - a.devices.length));
    return list;
  }, [devices, groups, order]);

  const statValue = (key: string) =>
    key === "total" ? devices.length : key === "sites" ? groups.length : counts[key] ?? 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={
          <Button onClick={load} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh All
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {STAT_CARDS.map((s) => (
          <Card key={s.key} className="p-4">
            <p className={cn("text-3xl font-semibold tabular-nums", s.color)}>{statValue(s.key)}</p>
            <p className="mt-1 text-xs text-muted">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Devices by Site</h2>
        <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
          <button onClick={() => setOrder("az")} className={cn("rounded px-2 py-1 cursor-pointer", order === "az" ? "bg-surface-2 text-text" : "text-muted")}>A-Z</button>
          <button onClick={() => setOrder("count")} className={cn("rounded px-2 py-1 cursor-pointer", order === "count" ? "bg-surface-2 text-text" : "text-muted")}>By count</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : (
        <Table
          head={
            <>
              <Th>Device</Th><Th>Host</Th><Th>Status</Th><Th>Method</Th><Th>RouterOS</Th>
              <Th>Board</Th><Th>CPU</Th><Th>RAM</Th><Th>Temp</Th><Th>Uptime</Th>
            </>
          }
        >
          {sites.map((site) => (
            <SiteRows key={site.id ?? "none"} name={site.name} devices={site.devices} statuses={statuses} />
          ))}
        </Table>
      )}
    </div>
  );
}

function SiteRows({ name, devices, statuses }: { name: string; devices: Device[]; statuses: StatusMap }) {
  return (
    <>
      <tr className="bg-surface-2/50">
        <Td className="text-xs font-semibold uppercase tracking-wide text-muted">{name} ({devices.length})</Td>
        <Td /><Td /><Td /><Td /><Td /><Td /><Td /><Td /><Td />
      </tr>
      {devices.map((d) => {
        const meta = STATUS_META[statusOf(statuses, d.id)];
        const st = statuses.get(d.id);
        const v = (x: string | number | null | undefined) => (x == null || x === "" ? "—" : String(x));
        return (
          <tr key={d.id} className="hover:bg-surface-2 transition-colors duration-200">
            <Td className="font-medium"><Link to={`/devices/${d.id}`} className="hover:text-primary cursor-pointer">{d.name}</Link></Td>
            <Td className="font-mono text-muted">{d.ip}</Td>
            <Td><span className="inline-flex items-center gap-1.5 text-xs"><span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {meta.label}</span></Td>
            <Td className="text-muted"><Badge>{methodOf(d)}</Badge></Td>
            <Td className="font-mono text-muted">{v(st?.version)}</Td>
            <Td className="font-mono text-muted">{v(st?.board)}</Td>
            <Td className="font-mono text-muted">{st?.cpu_load != null ? `${st.cpu_load}%` : "—"}</Td>
            <Td className="font-mono text-muted">{st?.ram_used_pct != null ? `${st.ram_used_pct}%` : "—"}</Td>
            <Td className="font-mono text-muted">{st?.temperature ? `${st.temperature}°C` : "—"}</Td>
            <Td className="font-mono text-muted">{v(st?.uptime)}</Td>
          </tr>
        );
      })}
    </>
  );
}
