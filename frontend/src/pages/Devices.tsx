import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, KeyRound, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Device, DeviceStatusInfo, Group, OrgMeta } from "@/lib/types";
import { groupBySite, methodOf, statusOf, STATUS_META, toStatusMap, type DeviceStatus, type StatusMap } from "@/lib/mikrotik";
import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, Card, EmptyState, Input, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const FILTERS: DeviceStatus[] = ["online", "not_accessible", "offline", "unknown", "disabled"];

// Chave da empresa dona do device. Master enxerga várias ORGs; devices dele
// (org_id null) formam o balde "Sistema". "all" = sem filtro.
type CompanyKey = number | "system";
const companyKey = (d: Device): CompanyKey => d.org_id ?? "system";

export function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [statuses, setStatuses] = useState<StatusMap>(new Map());
  const [orgs, setOrgs] = useState<OrgMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<DeviceStatus | null>(null);
  const [company, setCompany] = useState<CompanyKey | "all">("all");
  const { t } = useTranslation();
  const { user } = useAuth();
  const isMaster = user?.role === "master";

  function load() {
    setLoading(true);
    const calls = [
      api.get<Device[]>("/devices"),
      api.get<Group[]>("/groups"),
      api.get<DeviceStatusInfo[]>("/devices/status"),
    ] as const;
    Promise.all(calls)
      .then(([d, g, s]) => {
        setDevices(d);
        setGroups(g);
        setStatuses(toStatusMap(s));
      })
      .finally(() => setLoading(false));
    // Nomes das empresas — só o Master lista ORGs (endpoint require_master).
    if (isMaster) api.get<OrgMeta[]>("/admin/orgs").then(setOrgs).catch(() => {});
  }
  useEffect(load, [isMaster]);

  const orgName = useMemo(() => {
    const byId = new Map(orgs.map((o) => [o.id, o.name]));
    return (key: CompanyKey) => (key === "system" ? t("devices:list.systemCompany") : byId.get(key) ?? `Org ${key}`);
  }, [orgs, t]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of devices) {
      const s = statusOf(statuses, d.id);
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [devices, statuses]);

  // Empresas presentes nos devices (para o filtro), com contagem, ordenadas por nome.
  const companyCounts = useMemo(() => {
    const c = new Map<CompanyKey, number>();
    for (const d of devices) c.set(companyKey(d), (c.get(companyKey(d)) ?? 0) + 1);
    return [...c.entries()]
      .map(([key, n]) => ({ key, name: orgName(key), count: n }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [devices, orgName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter(
      (d) =>
        (!active || statusOf(statuses, d.id) === active) &&
        (company === "all" || companyKey(d) === company) &&
        (!q || d.name.toLowerCase().includes(q) || d.ip.toLowerCase().includes(q)),
    );
  }, [devices, statuses, search, active, company]);

  // Master: agrupa por empresa e, dentro, por site. Demais: só por site.
  const companyGroups = useMemo(() => {
    const buckets = new Map<CompanyKey, Device[]>();
    for (const d of filtered) {
      const k = companyKey(d);
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(d);
    }
    return [...buckets.entries()]
      .map(([key, devs]) => ({ key, name: orgName(key), devices: devs }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, orgName]);

  const renderSites = (devs: Device[]) =>
    groupBySite(devs, groups, t("common:labels.noSite")).map((site) => (
      <div key={site.id ?? "none"}>
        <p className="mb-2 text-sm font-semibold">{site.name} <span className="text-muted">({site.devices.length})</span></p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {site.devices.map((d) => (
            <DeviceCard key={d.id} device={d} status={statuses.get(d.id)} />
          ))}
        </div>
      </div>
    ));

  return (
    <div>
      <PageHeader
        title={t("devices:list.title")}
        subtitle={t("devices:list.subtitle", { count: devices.length })}
        actions={<Link to="/devices/new"><Button><Plus className="h-4 w-4" /> {t("devices:list.add")}</Button></Link>}
      />

      <Card className="mb-5 p-3">
        {/* Linha 1: busca + empresa (Master) */}
        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("devices:list.searchPlaceholder")} className="w-full sm:w-72" />
          {isMaster && (
            <Select
              value={String(company)}
              onChange={(e) => setCompany(e.target.value === "all" ? "all" : e.target.value === "system" ? "system" : Number(e.target.value))}
              className="w-full sm:w-56"
              aria-label={t("devices:list.companyFilter")}
            >
              <option value="all">{t("devices:list.allCompanies")}</option>
              {companyCounts.map((c) => (
                <option key={c.key} value={String(c.key)}>{c.name} ({c.count})</option>
              ))}
            </Select>
          )}
        </div>
        {/* Linha 2: filtros de status */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          {FILTERS.map((f) => {
            const meta = STATUS_META[f];
            const on = active === f;
            return (
              <button
                key={f}
                onClick={() => setActive(on ? null : f)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 cursor-pointer",
                  on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                {t(`common:deviceStatus.${f}`)}
                <span className={cn("tabular-nums", on ? "text-primary/70" : "text-muted/70")}>{counts[f] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : filtered.length === 0 ? (
        devices.length === 0 ? (
          // Sem NENHUM device: orienta configurar as Credenciais de acesso primeiro.
          <EmptyState
            title={t("devices:list.emptyTitle")}
            hint={t("devices:list.emptyCredentialsHint")}
            action={
              <Link to="/credentials">
                <Button><KeyRound className="h-4 w-4" /> {t("devices:list.emptyCredentialsAction")}</Button>
              </Link>
            }
          />
        ) : (
          // Há devices, mas os filtros zeraram o resultado.
          <EmptyState title={t("devices:list.emptyTitle")} hint={t("devices:list.emptyFilteredHint")} />
        )
      ) : isMaster ? (
        // Master: uma seção por empresa (com contagem) e os sites dentro dela.
        <div className="space-y-8">
          {companyGroups.map((c) => (
            <section key={c.key}>
              <div className="mb-3 flex items-center gap-2 border-b border-border pb-2">
                <Building2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">{c.name}</h2>
                <Badge tone="muted">{c.devices.length}</Badge>
              </div>
              <div className="space-y-5">{renderSites(c.devices)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-6">{renderSites(filtered)}</div>
      )}
    </div>
  );
}

function DeviceCard({ device, status }: { device: Device; status?: DeviceStatusInfo }) {
  const { t } = useTranslation();
  const deviceStatus = (status?.status as DeviceStatus) ?? "unknown";
  const meta = STATUS_META[deviceStatus];
  const v = (x: string | number | null | undefined) => (x == null || x === "" ? "—" : String(x));
  const rows: [string, string][] = [
    [t("common:labels.host"), device.ip],
    [t("devices:labels.method"), methodOf(device)],
    [t("devices:labels.routeros"), v(status?.version)],
    [t("devices:labels.board"), v(status?.board)],
    [t("devices:labels.uptime"), v(status?.uptime)],
    [t("devices:labels.cpu"), status?.cpu_load != null ? `${status.cpu_load}%` : "—"],
  ];
  return (
    <Link to={`/devices/${device.id}`}>
      <Card className="cursor-pointer p-4 transition-colors duration-200 hover:border-primary/50">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-tight">{device.name}</h3>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {t(`common:deviceStatus.${deviceStatus}`)}
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
