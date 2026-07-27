/**
 * Aba Observabilidade (/logs) — erros e eventos da aplicação.
 *
 * Só o Admin Master chega aqui. Esconder a aba é conveniência de interface: a
 * regra de verdade está no backend (`require_master` em /observability/*), que
 * devolve 403 mesmo se alguém chamar a API na mão.
 *
 * A leitura é humanizada — cada evento vira "o que aconteceu" em linguagem
 * comum; mensagem crua, rota, request id e stack trace ficam nos detalhes, para
 * quem for de fato investigar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ObsEvent, ObsEventDetail, ObsEventPage, ObsSummary } from "@/lib/types";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const PERIODS = ["1h", "6h", "24h", "168h", "720h"] as const;
type Period = (typeof PERIODS)[number];

/** Filtro de severidade → níveis enviados ao backend. */
const LEVEL_FILTERS = {
  errors: "CRITICAL,ERROR",
  warning: "WARNING",
  info: "INFO",
} as const;
type LevelFilter = keyof typeof LEVEL_FILTERS;

const badgeTone = (level: string) =>
  level === "CRITICAL" || level === "ERROR" ? "danger" : level === "WARNING" ? "accent" : "muted";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ObservabilityTab() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<ObsSummary | null>(null);
  const [page, setPage] = useState<ObsEventPage | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  const [period, setPeriod] = useState<Period>("24h");
  const [level, setLevel] = useState<LevelFilter | "">("");
  const [service, setService] = useState("");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const hours = Number(period.replace("h", ""));

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    const qs = new URLSearchParams({ hours: String(hours), limit: "200" });
    if (level) qs.set("level", LEVEL_FILTERS[level]);
    if (service) qs.set("service", service);
    if (search.trim()) qs.set("q", search.trim());
    try {
      const [events, resumo] = await Promise.all([
        api.get<ObsEventPage>(`/observability/events?${qs}`),
        api.get<ObsSummary>(`/observability/summary?hours=${hours}`),
      ]);
      setPage(events);
      setSummary(resumo);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [hours, level, service, search]);

  // Busca digitada: espera o usuário parar de teclar antes de ir ao servidor.
  useEffect(() => {
    const id = setTimeout(load, search ? 400 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  useEffect(() => {
    api.get<string[]>("/observability/services").then(setServices).catch(() => {});
  }, []);

  const items = page?.items ?? [];
  const hasFilters = Boolean(level || service || search);

  return (
    <div className="space-y-4">
      <SummaryCards summary={summary} />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-48">
            {PERIODS.map((p) => <option key={p} value={p}>{t(`ops:observability.periods.${p}`)}</option>)}
          </Select>
          <Select value={level} onChange={(e) => setLevel(e.target.value as LevelFilter | "")} className="w-48">
            <option value="">{t("ops:observability.filters.allLevels")}</option>
            {(Object.keys(LEVEL_FILTERS) as LevelFilter[]).map((k) => (
              <option key={k} value={k}>{t(`ops:observability.levelFilter.${k}`)}</option>
            ))}
          </Select>
          <Select value={service} onChange={(e) => setService(e.target.value)} className="w-48">
            <option value="">{t("ops:observability.filters.allServices")}</option>
            {services.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("ops:observability.filters.search")}
            className="max-w-xs"
          />
          <Button variant="ghost" onClick={load} disabled={busy}>
            {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {t("ops:observability.refresh")}
          </Button>
          {hasFilters && (
            <Button variant="ghost" onClick={() => { setLevel(""); setService(""); setSearch(""); }}>
              {t("ops:observability.filters.clear")}
            </Button>
          )}
          {page && <span className="text-xs text-muted">{t("ops:observability.count", { count: page.total })}</span>}
        </div>
        {page?.truncated && (
          <p className="mt-3 flex items-center gap-2 text-xs text-accent">
            <AlertTriangle className="h-3.5 w-3.5" /> {t("ops:observability.truncated")}
          </p>
        )}
        {err && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
      </Card>

      <TopErrors summary={summary} onOpen={setDetailId} />

      {busy && !page ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : summary && !summary.available ? (
        <EmptyState title={t("ops:observability.unavailable")} hint={t("ops:observability.unavailableHint")} />
      ) : items.length === 0 ? (
        <EmptyState title={t("ops:observability.emptyTitle")} hint={t("ops:observability.emptyHint")} />
      ) : (
        <Table
          head={
            <>
              <Th>{t("ops:observability.table.time")}</Th>
              <Th>{t("ops:observability.table.level")}</Th>
              <Th>{t("ops:observability.table.service")}</Th>
              <Th>{t("ops:observability.table.what")}</Th>
              <Th>{t("ops:observability.table.where")}</Th>
            </>
          }
        >
          {items.map((ev, i) => <EventRow key={ev.id ?? i} ev={ev} onOpen={() => ev.id && setDetailId(ev.id)} />)}
        </Table>
      )}

      {detailId && <EventDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

// === Visão geral ===

function SummaryCards({ summary }: { summary: ObsSummary | null }) {
  const { t } = useTranslation();
  const cards = [
    { key: "total", value: summary?.total ?? 0, tone: "" },
    { key: "critical", value: summary?.critical ?? 0, tone: summary?.critical ? "text-danger" : "" },
    { key: "warnings", value: summary?.warnings ?? 0, tone: summary?.warnings ? "text-accent" : "" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.key}>
          <p className="text-xs text-muted">{t(`ops:observability.summary.${c.key}`)}</p>
          <p className={cn("mt-1 text-2xl font-semibold tabular-nums", c.tone)}>{c.value}</p>
        </Card>
      ))}
      <Card>
        <p className="text-xs text-muted">{t("ops:observability.summary.lastEvent")}</p>
        <p className="mt-1 text-sm">
          {summary?.last_event_ts ? fmtTime(summary.last_event_ts) : t("ops:observability.summary.never")}
        </p>
      </Card>
    </div>
  );
}

/** Erros repetidos agrupados — o atalho para "o que está quebrando agora". */
function TopErrors({ summary, onOpen }: { summary: ObsSummary | null; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  if (!summary) return null;
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-danger" />
        <h3 className="text-sm font-semibold">{t("ops:observability.topErrors.title")}</h3>
        <span className="text-xs text-muted">{t("ops:observability.topErrors.hint")}</span>
      </div>
      {summary.top_errors.length === 0 ? (
        <p className="text-sm text-muted">{t("ops:observability.topErrors.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {summary.top_errors.map((g) => (
            <li key={g.fingerprint} className="flex items-center gap-3 py-2">
              <Badge tone="danger">{t("ops:observability.topErrors.occurrences", { count: g.count })}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{t(`ops:observability.friendly.${g.friendly}`, g.message)}</p>
                <p className="truncate text-xs text-muted">{g.service} · {fmtTime(g.last_ts)}</p>
              </div>
              {g.last_id && (
                <Button variant="ghost" onClick={() => onOpen(g.last_id!)}>{t("ops:observability.details.open")}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// === Linha e detalhes ===

function EventRow({ ev, onOpen }: { ev: ObsEvent; onOpen: () => void }) {
  const { t } = useTranslation();
  const critical = ev.level === "CRITICAL" || ev.level === "ERROR";
  return (
    <tr
      onClick={onOpen}
      className={cn(
        "cursor-pointer transition-colors duration-200 hover:bg-surface-2",
        critical && "bg-danger/5",
      )}
    >
      <Td className="whitespace-nowrap text-xs text-muted">{fmtTime(ev.ts)}</Td>
      <Td><Badge tone={badgeTone(ev.level)}>{t(`ops:observability.levels.${ev.level}`, ev.level)}</Badge></Td>
      <Td className="whitespace-nowrap text-xs">{ev.service}</Td>
      {/* Humanizado; a mensagem crua fica no title e nos detalhes. */}
      <Td title={ev.message}>
        <span className={cn(critical && "font-medium")}>
          {t(`ops:observability.friendly.${ev.friendly}`, ev.message)}
        </span>
      </Td>
      <Td className="whitespace-nowrap font-mono text-xs text-muted">
        {ev.path ? `${ev.method ?? ""} ${ev.path}`.trim() : "—"}
      </Td>
    </tr>
  );
}

function EventDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [ev, setEv] = useState<ObsEventDetail | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .get<ObsEventDetail>(`/observability/events/${encodeURIComponent(id)}`)
      .then(setEv)
      .catch(() => setErr(t("ops:observability.details.loadFailed")));
  }, [id, t]);

  const rows = useMemo(() => {
    if (!ev) return [];
    return [
      ["requestId", ev.request_id],
      ["route", ev.path ? `${ev.method ?? ""} ${ev.path}`.trim() : null],
      ["status", ev.status],
      ["duration", ev.duration_ms != null ? `${ev.duration_ms} ms` : null],
      ["user", ev.user],
      ["org", ev.org_id],
      ["logger", ev.logger],
      ["errorType", ev.error_type],
    ].filter(([, v]) => v !== null && v !== undefined && v !== "") as [string, string | number][];
  }, [ev]);

  return (
    <Modal title={t("ops:observability.details.title")} onClose={onClose} wide>
      {err ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</p>
      ) : !ev ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <div className="flex items-center gap-2">
            <Badge tone={badgeTone(ev.level)}>{t(`ops:observability.levels.${ev.level}`, ev.level)}</Badge>
            <span className="text-xs text-muted">{ev.service} · {fmtTime(ev.ts)}</span>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted">{t("ops:observability.details.summary")}</p>
            <p className="text-sm">{t(`ops:observability.friendly.${ev.friendly}`, ev.message)}</p>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted">{t("ops:observability.details.rawMessage")}</p>
            <p className="whitespace-pre-wrap break-words font-mono text-xs">{ev.message}</p>
          </div>

          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">{t("ops:observability.details.technical")}</p>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {rows.map(([key, value]) => (
                <div key={key} className="flex gap-2 text-xs">
                  <dt className="text-muted">{t(`ops:observability.details.${key}`)}:</dt>
                  <dd className="break-all font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">{t("ops:observability.details.stack")}</p>
            {ev.stack ? (
              <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-surface-2 p-3 text-[11px] leading-relaxed">
                {ev.stack}
              </pre>
            ) : (
              <p className="text-xs text-muted">{t("ops:observability.details.noStack")}</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
