import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Device, DeviceStatusInfo, Group } from "@/lib/types";
import { groupBySite, methodOf, statusOf, STATUS_META, toStatusMap, type DeviceStatus, type StatusMap } from "@/lib/mikrotik";
import { PageHeader } from "@/components/PageHeader";
import { Button, Card, EmptyState, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const FILTERS: DeviceStatus[] = ["online", "not_accessible", "offline", "unknown", "disabled"];

export function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [statuses, setStatuses] = useState<StatusMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<DeviceStatus | null>(null);

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
    const c: Record<string, number> = {};
    for (const d of devices) {
      const s = statusOf(statuses, d.id);
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [devices, statuses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter(
      (d) =>
        (!active || statusOf(statuses, d.id) === active) &&
        (!q || d.name.toLowerCase().includes(q) || d.ip.toLowerCase().includes(q)),
    );
  }, [devices, statuses, search, active]);

  const sites = useMemo(() => groupBySite(filtered, groups), [filtered, groups]);

  return (
    <div>
      <PageHeader
        title="Dispositivos"
        subtitle={`${devices.length} dispositivo(s)`}
        actions={<Link to="/devices/new"><Button><Plus className="h-4 w-4" /> Adicionar Dispositivo</Button></Link>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou host…" className="max-w-sm" />
        {FILTERS.map((f) => {
          const meta = STATUS_META[f];
          const on = active === f;
          return (
            <button
              key={f}
              onClick={() => setActive(on ? null : f)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors duration-200 cursor-pointer",
                on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted hover:bg-surface-2",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
              {meta.label}
              {counts[f] ? <span className="text-muted">({counts[f]})</span> : null}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhum device" hint="Cadastre um device ou ajuste os filtros." />
      ) : (
        <div className="space-y-6">
          {sites.map((site) => (
            <div key={site.id ?? "none"}>
              <p className="mb-2 text-sm font-semibold">{site.name} <span className="text-muted">({site.devices.length})</span></p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {site.devices.map((d) => <DeviceCard key={d.id} device={d} status={statuses.get(d.id)} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceCard({ device, status }: { device: Device; status?: DeviceStatusInfo }) {
  const meta = STATUS_META[(status?.status as DeviceStatus) ?? "unknown"];
  const v = (x: string | number | null | undefined) => (x == null || x === "" ? "—" : String(x));
  const rows: [string, string][] = [
    ["Host", device.ip],
    ["Método", methodOf(device)],
    ["RouterOS", v(status?.version)],
    ["Board", v(status?.board)],
    ["Uptime", v(status?.uptime)],
    ["CPU", status?.cpu_load != null ? `${status.cpu_load}%` : "—"],
  ];
  return (
    <Link to={`/devices/${device.id}`}>
      <Card className="cursor-pointer p-4 transition-colors duration-200 hover:border-primary/50">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-tight">{device.name}</h3>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {meta.label}
          </span>
        </div>
        <dl className="space-y-1 text-xs">
          {rows.map(([k, val]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono text-text">{val}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </Link>
  );
}
