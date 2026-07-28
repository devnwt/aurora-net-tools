import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rosGet } from "@/lib/rosClient";
import type { Device, LogsResp, RosRecord } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, Card, EmptyState, Input, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { ObservabilityTab } from "@/pages/Observability";

const errMsg = (e: unknown) =>
  e instanceof ApiError ? i18n.t("ops:shared.errorWithStatus", { status: e.status, message: e.message }) : String(e);

function tone(topics: string): string {
  const t = (topics || "").toLowerCase();
  if (t.includes("critical") || t.includes("error")) return "text-danger";
  if (t.includes("warning")) return "text-accent";
  return "";
}

type Tab = "device" | "observability";

export function Logs() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // A aba de Observabilidade é exclusiva do Admin Master. Isto aqui é só a
  // interface: o backend recusa /observability/* para qualquer outro papel.
  const isMaster = user?.role === "master";
  const [tab, setTab] = useState<Tab>("device");
  const tabs: Tab[] = isMaster ? ["device", "observability"] : ["device"];
  const active = tabs.includes(tab) ? tab : "device";

  return (
    <div>
      <PageHeader
        title={t("ops:logs.title")}
        subtitle={active === "observability" ? t("ops:observability.subtitle") : t("ops:logs.subtitle")}
      />
      {isMaster && (
        <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-border">
          {tabs.map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "cursor-pointer rounded-t-lg px-4 py-2 text-sm transition-colors duration-200",
                active === key ? "border-b-2 border-primary font-medium text-primary" : "text-muted hover:text-text",
              )}
            >
              {t(`ops:logs.tabs.${key}`)}
            </button>
          ))}
        </div>
      )}
      {active === "observability" ? <ObservabilityTab /> : <DeviceLogsTab />}
    </div>
  );
}

/** Logs lidos do próprio equipamento RouterOS (/log print) — comportamento original. */
function DeviceLogsTab() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [target, setTarget] = useState("");
  const [rows, setRows] = useState<RosRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<Device[]>("/devices").then((d) => setDevices(d.filter((x) => x.device_type === "routeros")));
  }, []);

  async function load(id: string) {
    if (!id) return;
    setBusy(true);
    setErr("");
    try {
      const r = await rosGet<LogsResp>(Number(id), "/logs");
      setRows([...r.logs].reverse()); // mais recentes primeiro
    } catch (e) {
      setErr(errMsg(e));
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter((r) => (r.message ?? "").toLowerCase().includes(q) || (r.topics ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              load(e.target.value);
            }}
            className="w-64"
          >
            <option value="">{t("ops:shared.selectRouterOS")}</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.ip}</option>)}
          </Select>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("ops:logs.filterPlaceholder")} className="max-w-xs" />
          <Button variant="ghost" onClick={() => load(target)} disabled={!target || busy}>
            {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {t("common:actions.refresh")}
          </Button>
          {rows && <span className="text-xs text-muted">{t("ops:logs.entryCount", { count: filtered.length })}</span>}
        </div>
        {err && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
      </Card>

      {busy && !rows ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : !rows ? (
        <EmptyState title={t("ops:shared.selectDeviceTitle")} hint={t("ops:logs.emptyHint")} />
      ) : filtered.length === 0 ? (
        <EmptyState title={t("ops:logs.noEntries")} />
      ) : (
        <Table head={<><Th>{t("ops:logs.col.time")}</Th><Th>{t("ops:logs.col.topics")}</Th><Th>{t("ops:logs.col.message")}</Th></>}>
          {filtered.map((r, i) => (
            <tr key={i} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="whitespace-nowrap font-mono text-xs text-muted">{r.time ?? "—"}</Td>
              <Td className={cn("whitespace-nowrap font-mono text-xs", tone(r.topics ?? ""))}>{r.topics ?? "—"}</Td>
              <Td className="font-mono text-xs">{r.message ?? ""}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
