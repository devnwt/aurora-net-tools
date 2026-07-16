import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Network, RefreshCw, Search } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cachedTl1, peekTl1 } from "@/lib/tl1cache";
import type {
  AlarmsResp,
  LocateOnu,
  LocateResp,
  OltsResp,
  OnusResp,
  PonsResp,
  Tl1Data,
  Tl1Record,
} from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, Card, EmptyState, Input, Select, Spinner } from "@/components/ui";

const errMsg = (e: unknown) => (e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));

// TTL do cache (frontend) para recursos estruturais que ~não mudam: 30 min.
const STRUCT_TTL = 30 * 60 * 1000;

const records = (d: Tl1Data | null | undefined): Tl1Record[] => (Array.isArray(d) ? d : []);
const dataError = (d: Tl1Data | null | undefined): string | null =>
  d && !Array.isArray(d) ? d.error : null;

/** Primeira chave presente no registro dentre as candidatas (case-insensitive). */
function pick(rec: Tl1Record, keys: string[]): string | null {
  const lower = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v) return v;
  }
  return null;
}

const oltIp = (r: Tl1Record) => pick(r, ["DEVIP", "NEIP", "OLTIP", "IP"]) ?? "";
const oltName = (r: Tl1Record) => pick(r, ["DEVNAME", "NAME", "NENAME", "ALIAS"]) ?? "(sem nome)";

/** Tabela genérica para registros TL1: colunas = união das chaves de todas as linhas. */
function RecordsTable({
  data,
  empty = "Sem registros",
  action,
}: {
  data: Tl1Data;
  empty?: string;
  action?: { label: string; onClick: (r: Tl1Record) => void; show?: (r: Tl1Record) => boolean };
}) {
  const err = dataError(data);
  if (err) return <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</p>;
  const rows = records(data);
  if (rows.length === 0) return <EmptyState title={empty} />;
  const cols = Array.from(
    rows.reduce((s, r) => {
      Object.keys(r).forEach((k) => s.add(k));
      return s;
    }, new Set<string>()),
  );
  return (
    <div>
      <p className="mb-2 text-xs text-muted">{rows.length} registro(s)</p>
      <Table
        head={
          <>
            {cols.map((c) => (
              <Th key={c} className="whitespace-nowrap">{c}</Th>
            ))}
            {action && <Th />}
          </>
        }
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-surface-2 transition-colors duration-200">
            {cols.map((c) => (
              <Td key={c} className="whitespace-nowrap font-mono text-xs">{r[c] ?? ""}</Td>
            ))}
            {action && (
              <Td className="text-right">
                {(!action.show || action.show(r)) && (
                  <Button variant="ghost" onClick={() => action.onClick(r)}>{action.label}</Button>
                )}
              </Td>
            )}
          </tr>
        ))}
      </Table>
    </div>
  );
}

/**
 * Consulta TL1 com cache por URL. `data` é primado do cache no mount;
 * `run(false)` usa o cache (instantâneo se já buscado), `run(true)` força a re-busca.
 */
function useTl1Query<T, R>(makeUrl: () => string, pick: (r: T) => R, ttl = STRUCT_TTL) {
  const [data, setData] = useState<R | null>(() => {
    const c = peekTl1<T>(makeUrl(), ttl);
    return c ? pick(c) : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(force: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await cachedTl1<T>(makeUrl(), ttl, force);
      setData(pick(r));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return { data, busy, error, run };
}

export function OltExplorer() {
  const { id } = useParams();
  const cid = Number(id);
  const url = `/controllers/${cid}/olts`;
  const cached0 = peekTl1<OltsResp>(url, STRUCT_TTL);
  const [controllerName, setControllerName] = useState(cached0?.controller ?? "");
  const [olts, setOlts] = useState<Tl1Data | null>(cached0?.olts ?? null);
  const [loading, setLoading] = useState(cached0 === null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<{ ip: string; name: string } | null>(null);

  // showSpinner=false → recarrega em segundo plano (já há dado de cache em tela).
  async function load(force: boolean, showSpinner: boolean) {
    if (showSpinner) setLoading(true);
    setErr("");
    try {
      const r = await cachedTl1<OltsResp>(url, STRUCT_TTL, force);
      setControllerName(r.controller);
      setOlts(r.olts);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const cached = peekTl1<OltsResp>(url, STRUCT_TTL);
    setControllerName(cached?.controller ?? "");
    setOlts(cached?.olts ?? null);
    setSelected(null); // troca de controller → volta para a lista
    load(false, cached === null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  const rows = records(olts);

  return (
    <div>
      <Link to="/controllers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text cursor-pointer">
        <ArrowLeft className="h-4 w-4" /> Controllers
      </Link>
      <PageHeader
        title={controllerName || "OLTs"}
        subtitle="Exploração ao vivo via TL1 (UNM2000)"
        actions={
          <Button variant="ghost" onClick={() => load(true, true)} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Atualizar
          </Button>
        }
      />

      {selected ? (
        <OltDetail cid={cid} olt={selected} onBack={() => setSelected(null)} />
      ) : loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : err ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</p>
      ) : dataError(olts) ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{dataError(olts)}</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhuma OLT" hint="O UNM2000 não retornou OLTs." />
      ) : (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">OLTs ({rows.length})</h2>
          </div>
          <RecordsTable
            data={olts as Tl1Data}
            action={{
              label: "Explorar",
              onClick: (r) => setSelected({ ip: oltIp(r), name: oltName(r) }),
              show: (r) => !!oltIp(r),
            }}
          />
        </Card>
      )}
    </div>
  );
}

type TabKey = "info" | "boards" | "shelves" | "pons" | "onus" | "states" | "unreg" | "alarms" | "locate";
const TABS: { key: TabKey; label: string }[] = [
  { key: "info", label: "Info" },
  { key: "boards", label: "Placas" },
  { key: "shelves", label: "Shelves" },
  { key: "pons", label: "PONs" },
  { key: "onus", label: "ONUs" },
  { key: "states", label: "Estados" },
  { key: "unreg", label: "Não-registradas" },
  { key: "alarms", label: "Alarmes" },
  { key: "locate", label: "Localizar ONU" },
];

function OltDetail({ cid, olt, onBack }: { cid: number; olt: { ip: string; name: string }; onBack: () => void }) {
  const [tab, setTab] = useState<TabKey>("pons");
  const [onuFilter, setOnuFilter] = useState<string>(""); // ponid pré-preenchido ao clicar numa PON

  function openOnus(ponid: string) {
    setOnuFilter(ponid);
    setTab("onus");
  }

  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text cursor-pointer">
        <ArrowLeft className="h-4 w-4" /> OLTs
      </button>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-lg font-semibold">{olt.name}</h2>
        <Badge tone="primary">{olt.ip}</Badge>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "cursor-pointer rounded-t-lg px-4 py-2 text-sm transition-colors duration-200 " +
              (tab === t.key ? "border-b-2 border-primary font-medium text-primary" : "text-muted hover:text-text")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "info" && <ListTab cid={cid} oltIp={olt.ip} path="" field="info" empty="Sem informações" ttl={STRUCT_TTL} />}
      {tab === "boards" && <ListTab cid={cid} oltIp={olt.ip} path="/boards" field="boards" empty="Sem placas" ttl={STRUCT_TTL} />}
      {tab === "shelves" && <ListTab cid={cid} oltIp={olt.ip} path="/shelves" field="shelves" empty="Sem shelves" ttl={STRUCT_TTL} />}
      {tab === "pons" && <PonsTab cid={cid} oltIp={olt.ip} onSeeOnus={openOnus} />}
      {tab === "onus" && <OnusTab cid={cid} oltIp={olt.ip} initialPon={onuFilter} />}
      {tab === "states" && <ListTab cid={cid} oltIp={olt.ip} path="/onu-states" field="states" empty="Sem estados" ttl={STRUCT_TTL} />}
      {tab === "unreg" && <ListTab cid={cid} oltIp={olt.ip} path="/unregistered" field="unregistered" empty="Nenhuma ONU não-registrada" ttl={STRUCT_TTL} />}
      {tab === "alarms" && <AlarmsTab cid={cid} oltIp={olt.ip} />}
      {tab === "locate" && <LocateTab cid={cid} oltIp={olt.ip} />}
    </div>
  );
}

/** Wrapper de carregamento sob demanda com estado de loading/erro e botão de recarregar. */
function Loader({
  load,
  children,
  cta = "Recarregar",
  auto = true,
  controls,
  primed = false,
}: {
  load: (force: boolean) => Promise<void>;
  children: React.ReactNode;
  cta?: string;
  auto?: boolean;
  controls?: React.ReactNode;
  primed?: boolean; // já há dado de cache em tela → não mostra spinner inicial
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadedOnce, setLoadedOnce] = useState(primed);

  async function run(force: boolean) {
    setBusy(true);
    setError("");
    try {
      await load(force);
      setLoadedOnce(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (auto) run(false); // mount → usa cache quando houver
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        {controls}
        <Button variant="ghost" onClick={() => run(true)} disabled={busy}>
          {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {cta}
        </Button>
      </div>
      {error && <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {busy && !loadedOnce ? <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div> : children}
    </Card>
  );
}

function PonsTab({ cid, oltIp, onSeeOnus }: { cid: number; oltIp: string; onSeeOnus: (ponid: string) => void }) {
  const url = `/controllers/${cid}/olts/${encodeURIComponent(oltIp)}/pons`;
  const [data, setData] = useState<Tl1Data | null>(() => peekTl1<PonsResp>(url, STRUCT_TTL)?.pons ?? null);
  return (
    <Loader
      primed={data !== null}
      load={async (force) => {
        const r = await cachedTl1<PonsResp>(url, STRUCT_TTL, force);
        setData(r.pons);
      }}
    >
      {data && (
        <RecordsTable
          data={data}
          empty="Sem PONs"
          action={{
            label: "Ver ONUs",
            onClick: (r) => {
              const pid = pick(r, ["PONID", "PON", "PORTID", "PORT"]);
              if (pid) onSeeOnus(pid);
            },
            show: (r) => !!pick(r, ["PONID", "PON", "PORTID", "PORT"]),
          }}
        />
      )}
    </Loader>
  );
}

function OnusTab({ cid, oltIp, initialPon }: { cid: number; oltIp: string; initialPon: string }) {
  const [pon, setPon] = useState(initialPon);
  const makeUrl = () =>
    `/controllers/${cid}/olts/${encodeURIComponent(oltIp)}/onus${pon ? `?ponid=${encodeURIComponent(pon)}` : ""}`;
  const q = useTl1Query<OnusResp, Tl1Data>(makeUrl, (r) => r.onus);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={pon}
          onChange={(e) => setPon(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !q.busy && q.run(false)}
          placeholder="Filtrar por PON (ex.: NA-NA-1-1) — vazio = todas"
          className="max-w-xs font-mono"
        />
        <Button onClick={() => q.run(false)} disabled={q.busy}>
          {q.busy ? <Spinner /> : <Search className="h-4 w-4" />} Buscar
        </Button>
        {q.data && (
          <Button variant="ghost" onClick={() => q.run(true)} disabled={q.busy}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        )}
      </div>
      {q.error && <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{q.error}</p>}
      {q.busy && !q.data ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : q.data ? (
        <RecordsTable data={q.data} empty="Sem ONUs" />
      ) : (
        <p className="text-xs text-muted">Informe uma PON (ou deixe vazio para todas) e clique em Buscar. Listar todas pode levar alguns segundos.</p>
      )}
    </Card>
  );
}

/** Aba de lista TL1 genérica (com cache): GET base+path, lê `field` e renderiza a tabela. */
function ListTab({
  cid,
  oltIp,
  path,
  field,
  empty,
  ttl,
}: {
  cid: number;
  oltIp: string;
  path: string;
  field: string;
  empty?: string;
  ttl: number; // TTL do cache (frontend)
}) {
  const url = `/controllers/${cid}/olts/${encodeURIComponent(oltIp)}${path}`;
  const [data, setData] = useState<Tl1Data | null>(
    () => (peekTl1<Record<string, unknown>>(url, ttl)?.[field] as Tl1Data) ?? null,
  );
  return (
    <Loader
      primed={data !== null}
      load={async (force) => {
        const r = await cachedTl1<Record<string, unknown>>(url, ttl, force);
        setData(r[field] as Tl1Data);
      }}
    >
      {data && <RecordsTable data={data} empty={empty} />}
    </Loader>
  );
}

function AlarmsTab({ cid, oltIp }: { cid: number; oltIp: string }) {
  const [since, setSince] = useState("");
  const makeUrl = () =>
    `/controllers/${cid}/olts/${encodeURIComponent(oltIp)}/alarms${since ? `?start=${encodeURIComponent(since)}` : ""}`;
  const q = useTl1Query<AlarmsResp, string[]>(makeUrl, (r) => (r.alarms ?? []).filter((l) => l && l !== ";"));

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={since}
          onChange={(e) => setSince(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !q.busy && q.run(false)}
          placeholder="Desde (ex.: 2026-06-23 00:00:00) — opcional"
          className="max-w-xs font-mono"
        />
        <Button onClick={() => q.run(false)} disabled={q.busy}>
          {q.busy ? <Spinner /> : <Search className="h-4 w-4" />} Consultar
        </Button>
        {q.data && (
          <Button variant="ghost" onClick={() => q.run(true)} disabled={q.busy}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        )}
      </div>
      {q.error && <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{q.error}</p>}
      {q.busy && !q.data ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : q.data ? (
        q.data.length === 0 ? (
          <EmptyState title="Sem alarmes" />
        ) : (
          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-xs text-text whitespace-pre-wrap">
            {q.data.join("\n")}
          </pre>
        )
      ) : (
        <p className="text-xs text-muted">Consulte os alarmes ativos da OLT (opcionalmente a partir de uma data/hora).</p>
      )}
    </Card>
  );
}

const LOCATE_SECTIONS: { key: keyof LocateOnu; label: string }[] = [
  { key: "query", label: "Localização (slot/PON)" },
  { key: "state", label: "Estado" },
  { key: "optical", label: "Sinal óptico (DDM)" },
  { key: "info", label: "Informações do equipamento" },
  { key: "lan_port", label: "Portas LAN" },
  { key: "config", label: "Configuração" },
  { key: "macaddress", label: "MACs aprendidos" },
  { key: "lan_info", label: "Status das portas LAN" },
];

function LocateTab({ cid, oltIp }: { cid: number; oltIp: string }) {
  const [onuid, setOnuid] = useState("");
  const [onutype, setOnutype] = useState("MAC");
  const makeUrl = () =>
    `/controllers/${cid}/olts/${encodeURIComponent(oltIp)}/onu/locate?onuid=${encodeURIComponent(onuid)}&onutype=${onutype}`;
  const q = useTl1Query<LocateResp, LocateResp["onu"]>(makeUrl, (r) => r.onu);

  const onuError = q.data && "error" in q.data ? q.data.error : null;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Search className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Localizar ONU por ID</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select className="w-28" value={onutype} onChange={(e) => setOnutype(e.target.value)} aria-label="Tipo de ID">
          <option value="MAC">MAC</option>
          <option value="LOID">LOID</option>
        </Select>
        <Input
          value={onuid}
          onChange={(e) => setOnuid(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !q.busy && onuid && q.run(false)}
          placeholder="ex.: 48575443A1B2"
          className="max-w-xs font-mono"
        />
        <Button onClick={() => q.run(false)} disabled={q.busy || !onuid}>
          {q.busy ? <Spinner /> : "Localizar"}
        </Button>
        {q.data && !onuError && (
          <Button variant="ghost" onClick={() => q.run(true)} disabled={q.busy || !onuid}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        )}
      </div>

      {q.error && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{q.error}</p>}
      {onuError && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{onuError}</p>}

      {q.data && !onuError && (
        <div className="mt-4 space-y-5">
          {LOCATE_SECTIONS.map(({ key, label }) => (
            <div key={key}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
              <RecordsTable data={(q.data as LocateOnu)[key]} empty="—" />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
