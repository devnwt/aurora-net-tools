import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play, RefreshCw, Share2, Zap } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { rosGet, rosPost } from "@/lib/rosClient";
import { ForceGraph, type GEdge, type GNode } from "@/components/ForceGraph";
import type { Device, DeviceSample, Group, NetInfoResp, OverviewResp, RosRecord, TrafficResp } from "@/lib/types";
import { Badge, Button, Card, Input, Modal, Select, Spinner } from "@/components/ui";
import { Table, Td, Th } from "@/components/Table";
import { DeviceImage } from "@/components/DeviceImage";
import { DeviceMap } from "@/components/DeviceMap";
import { LineChart } from "@/components/LineChart";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));

/** Busca um recurso ao montar (e via reload), com loading/erro. `key` dispara o efeito. */
function useResource<T>(key: string | null, loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!key) return;
    setBusy(true);
    setError("");
    try {
      setData(await loader());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, busy, error, reload: load };
}

export function DeviceDetail() {
  const { id } = useParams();
  const did = Number(id);
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [lastCheck, setLastCheck] = useState<string>("");
  const [liveIface, setLiveIface] = useState("");
  const [showNeighbors, setShowNeighbors] = useState(false);
  const [geo, setGeo] = useState<{ lat: number; lon: number; src: "device" | "site" } | null>(null);
  const [pick, setPick] = useState<{ lat: number; lon: number } | null>(null);
  const [savingGeo, setSavingGeo] = useState(false);

  async function saveGeo() {
    if (!pick || !device) return;
    setSavingGeo(true);
    try {
      const updated = await api.patch<Device>(`/devices/${device.id}`, { latitude: pick.lat, longitude: pick.lon });
      setDevice(updated);
      setPick(null);
    } finally {
      setSavingGeo(false);
    }
  }

  useEffect(() => {
    api.get<Device>(`/devices/${id}`).then(setDevice);
  }, [id]);

  // Coordenadas do device (fallback: as do site/grupo).
  useEffect(() => {
    if (!device) return;
    if (device.latitude != null && device.longitude != null) {
      setGeo({ lat: device.latitude, lon: device.longitude, src: "device" });
      return;
    }
    setGeo(null);
    if (device.group_id) {
      api.get<Group>(`/groups/${device.group_id}`)
        .then((g) => { if (g.latitude != null && g.longitude != null) setGeo({ lat: g.latitude, lon: g.longitude, src: "site" }); })
        .catch(() => {});
    }
  }, [device]);

  const isRos = device?.device_type === "routeros";
  const ov = useResource<OverviewResp>(device && isRos ? `ov:${did}` : null, () => rosGet<OverviewResp>(did, "/overview"));

  useEffect(() => {
    if (ov.data) setLastCheck(new Date().toLocaleString("pt-BR"));
  }, [ov.data]);

  if (!device) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>;

  const s = ov.data?.summary;
  const interfaces = ov.data?.interfaces ?? [];
  const services = ov.data?.services ?? [];
  const status = ov.busy ? "checking" : ov.error ? "not_accessible" : ov.data ? "online" : "unknown";
  const statusMeta = {
    online: { label: "Online", dot: "bg-ok", text: "text-ok" },
    not_accessible: { label: "Not accessible", dot: "bg-accent", text: "text-accent" },
    checking: { label: "Checando…", dot: "bg-muted", text: "text-muted" },
    unknown: { label: "Unknown", dot: "bg-muted", text: "text-muted" },
  }[status];

  async function remove() {
    if (!confirm(`Excluir o device "${device!.name}"?`)) return;
    await api.del(`/devices/${id}`);
    navigate("/devices");
  }

  return (
    <div>
      {/* Cabeçalho inline */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to="/devices" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text cursor-pointer">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-xl font-semibold">{device.name}</h1>
        <span className={cn("inline-flex items-center gap-1.5 text-sm", statusMeta.text)}>
          <span className={cn("h-2 w-2 rounded-full", statusMeta.dot)} /> {statusMeta.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isRos && <Button variant="ghost" onClick={() => setShowNeighbors(true)}><Share2 className="h-4 w-4" /> Neighbors</Button>}
          <Button variant="ghost" onClick={ov.reload} disabled={ov.busy}>
            {ov.busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Test Connection
          </Button>
          <Link to={`/devices/${id}/edit`}><Button variant="ghost">Edit</Button></Link>
          <Button variant="danger" onClick={remove}>Delete</Button>
        </div>
      </div>

      {!isRos && (
        <Card className="mb-5 text-sm text-muted">
          Este device é <Badge tone="accent">{device.device_type}</Badge>. As telas ao vivo são específicas de
          RouterOS — use a aba Command abaixo.
        </Card>
      )}

      {/* Cards de saúde */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="CPU LOAD" value={s?.cpu_load != null ? `${s.cpu_load}%` : "—"} bar={s?.cpu_load != null ? Number(s.cpu_load) : undefined} />
        <StatCard label="RAM USED" value={s?.ram_used_pct != null ? `${s.ram_used_pct}%` : "—"} bar={s?.ram_used_pct ?? undefined} />
        <StatCard label="TEMPERATURE" value={s?.temperature ? `${s.temperature}°C` : "—"} />
        <StatCard label="UPTIME" value={s?.uptime ?? "—"} />
        <PingCard deviceId={did} />
      </div>

      {/* Info + ilustração */}
      <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_320px]">
        <Card className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Info label="HOST" value={device.ip} mono />
          <Info label="BOARD" value={s?.board ?? "—"} mono />
          <Info label="ARCHITECTURE" value={s?.architecture ?? "—"} mono />
          <Info label="METHOD" value={<MethodBadges device={device} />} />
          <Info label="ROUTEROS" value={s?.version ?? "—"} mono />
          <Info label="LAST CHECK" value={lastCheck || "—"} mono />
        </Card>
        <Card className="flex items-center justify-center overflow-hidden p-0">
          {geo ? (
            <div className="w-full">
              <DeviceMap lat={geo.lat} lon={geo.lon} label={device.name} height={228} />
              <p className="px-3 py-1.5 text-[11px] text-muted">📍 {geo.lat.toFixed(5)}, {geo.lon.toFixed(5)} {geo.src === "site" && <span className="text-muted/70">(do site)</span>}</p>
            </div>
          ) : (
            <div className="w-full">
              <DeviceMap lat={pick?.lat ?? null} lon={pick?.lon ?? null} label={device.name} height={228} onPick={(la, lo) => setPick({ lat: la, lon: lo })} />
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <p className="text-[11px] text-muted">
                  {pick ? <>📍 {pick.lat.toFixed(5)}, {pick.lon.toFixed(5)}</> : "Clique no mapa para definir a localização"}
                </p>
                {pick && (
                  <Button onClick={saveGeo} disabled={savingGeo} className="px-2.5 py-1 text-xs">{savingGeo ? "Salvando…" : "Salvar"}</Button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Services */}
      {isRos && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">Services</span>
          {ov.busy && services.length === 0 ? (
            <Spinner />
          ) : (
            services.map((sv, i) => <ServiceChip key={i} svc={sv} />)
          )}
        </div>
      )}

      {/* Interfaces (com o desenho de portas ao lado) */}
      {isRos && (
        <Card className="mb-5">
          <SectionHeader title="Interfaces" busy={ov.busy} onReload={ov.reload} count={interfaces.length} />
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div>{ov.error ? <ErrorNote msg={ov.error} /> : <InterfaceMap rows={interfaces} selected={liveIface} onSelect={setLiveIface} />}</div>
            <div className="flex items-start justify-center lg:border-l lg:border-border lg:pl-4">
              <DeviceImage
                board={s?.board_name || s?.board || ""}
                ports={interfaces.filter((i) => (i.type ?? "").includes("ether")).length || 5}
                className="w-full max-w-[300px] object-contain"
              />
            </div>
          </div>
        </Card>
      )}

      {isRos && <ProtocolsCard deviceId={did} />}

      {isRos && <HealthCard deviceId={did} />}

      {isRos && <LiveTrafficCard deviceId={did} interfaces={interfaces} iface={liveIface} onSelect={setLiveIface} />}

      {isRos && <DeviceTabs deviceId={did} />}

      <CommandPanel deviceId={did} />

      {showNeighbors && <NeighborsModal deviceId={did} deviceName={device.name} onClose={() => setShowNeighbors(false)} />}
    </div>
  );
}

function StatCard({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ok">{value}</p>
      {bar != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-primary" style={{ width: `${Math.min(Math.max(bar, 0), 100)}%` }} />
        </div>
      )}
    </Card>
  );
}

interface PingResp { ok: boolean; host: string; alive: boolean; loss_pct: number; avg_ms: number | null; min_ms: number | null; max_ms: number | null }

function PingCard({ deviceId }: { deviceId: number }) {
  const [p, setP] = useState<PingResp | null>(null);
  const [busy, setBusy] = useState(true);

  async function run() {
    setBusy(true);
    try { setP(await api.get<PingResp>(`/devices/${deviceId}/ping`)); } catch { /* ignora */ } finally { setBusy(false); }
  }
  useEffect(() => {
    run();
    const t = setInterval(run, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const avg = p?.avg_ms;
  const tone = !p?.alive ? "text-danger" : avg == null ? "text-muted" : avg < 20 ? "text-ok" : avg < 80 ? "text-accent" : "text-danger";
  const value = busy && !p ? "…" : !p?.alive ? "timeout" : avg != null ? `${avg.toFixed(1)} ms` : "—";

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted">PING (ICMP)</p>
        <button onClick={run} disabled={busy} className="text-muted hover:text-text cursor-pointer" title="Testar agora">
          {busy ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className={cn("mt-1 text-2xl font-semibold", tone)}>{value}</p>
      <p className="mt-1 text-[11px] text-muted">
        {p ? <>perda {p.loss_pct}%{p.min_ms != null && <> · {p.min_ms}/{p.max_ms} ms</>}</> : "medindo…"}
      </p>
    </Card>
  );
}

function Info({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <div className={cn("mt-0.5 text-sm", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function MethodBadges({ device }: { device: Device }) {
  const methods: [string, boolean][] = [
    ["SSH", device.ssh_enabled],
    ["REST", device.api_enabled],
    ["SNMP", device.snmp_enabled],
  ];
  return (
    <div className="flex gap-1.5 text-xs">
      {methods.map(([m, on]) => (
        <span key={m} className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium", on ? "bg-ok/15 text-ok" : "bg-surface-2 text-muted")}>
          {m}{on && " ✓"}
        </span>
      ))}
    </div>
  );
}

const INSECURE = new Set(["ftp", "telnet", "www", "api"]);

function ServiceChip({ svc }: { svc: RosRecord }) {
  const disabled = svc.disabled === "true" || (svc.flags ?? "").includes("X");
  const insecure = INSECURE.has(svc.name ?? "");
  const tone = disabled ? "muted" : insecure ? "accent" : "ok";
  const classes = {
    muted: "bg-surface-2 text-muted line-through",
    accent: "bg-accent/15 text-accent",
    ok: "bg-ok/15 text-ok",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[11px]", classes)}>
      {svc.name}:{svc.port}{!disabled && insecure ? " ⚠" : ""}
    </span>
  );
}

function SectionHeader({ title, busy, onReload, count }: { title: string; busy?: boolean; onReload?: () => void; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold">
        {title} {count != null && <span className="text-muted">({count})</span>}
      </h2>
      {onReload && (
        <Button variant="ghost" onClick={onReload} disabled={busy}>
          {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      )}
    </div>
  );
}

function ErrorNote({ msg }: { msg: string }) {
  return <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{msg}</p>;
}

// === Health (série temporal do poller) ===

const METRICS = [
  { key: "temperature", label: "Cpu Temperature", color: "#22D3EE", unit: "°C" },
  { key: "cpu_load", label: "Cpu Load", color: "#3B82F6", unit: "%" },
  { key: "ram_used_pct", label: "Ram Used", color: "#22C55E", unit: "%" },
] as const;
const RANGES = [
  { label: "6h", h: 6 },
  { label: "24h", h: 24 },
  { label: "7d", h: 168 },
  { label: "30d", h: 720 },
];

function HealthCard({ deviceId }: { deviceId: number }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]>(METRICS[0]);
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<DeviceSample[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const d = await api.get<DeviceSample[]>(`/devices/${deviceId}/samples?hours=${hours}`);
        if (alive) setData(d);
      } catch {
        /* silencioso — métricas são secundárias */
      }
    }
    load();
    const t = setInterval(load, 30000); // acompanha o poller
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [deviceId, hours]);

  const points = data
    .map((d) => ({ t: new Date(d.ts).getTime(), v: d[metric.key] }))
    .filter((p): p is { t: number; v: number } => p.v != null && Number.isFinite(p.v));
  const vals = points.map((p) => p.v);
  const cur = vals.length ? vals[vals.length - 1] : null;
  const min = vals.length ? Math.min(...vals) : null;
  const max = vals.length ? Math.max(...vals) : null;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const f = (x: number | null) => (x == null ? "—" : `${x.toFixed(1)}${metric.unit}`);

  return (
    <Card className="mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Health — {metric.label}</h2>
        <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
          {RANGES.map((r) => (
            <button key={r.h} onClick={() => setHours(r.h)} className={cn("rounded px-2 py-1 cursor-pointer", hours === r.h ? "bg-primary/20 text-primary" : "text-muted")}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m)}
            className={cn("rounded-md px-3 py-1 text-xs cursor-pointer", metric.key === m.key ? "bg-surface-2 text-text" : "text-muted hover:text-text")}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-muted">
        Current: <span className="text-text">{f(cur)}</span> · min {f(min)} · max {f(max)} · avg {f(avg)}
      </p>
      <LineChart series={[{ points, color: metric.color }]} unit={metric.unit} id={`h-${metric.key}`} />
    </Card>
  );
}

// === Live Traffic por interface (monitor-traffic) ===

function fmtBps(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} Gbps`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} Mbps`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} Kbps`;
  return `${v} bps`;
}

const TRAFFIC_WINDOW = 60; // pontos no rolling chart

const isSfpIface = (name = "", type = "") => name.startsWith("sfp") || type.includes("sfp");

interface OpticsResp { ok: boolean; iface: string; optical: boolean; data: Record<string, string> }
interface PoeResp { ok: boolean; iface: string; poe: boolean; data: Record<string, string> }

function LiveTrafficCard({ deviceId, interfaces, iface, onSelect }: { deviceId: number; interfaces: RosRecord[]; iface: string; onSelect: (n: string) => void }) {
  const candidates = interfaces.filter(
    (i) => (i.type ?? "").includes("ether") || (i.name ?? "").startsWith("ether") || (i.name ?? "").startsWith("sfp") || (i.type ?? "") === "bridge" || (i.type ?? "") === "vlan",
  );
  const [live, setLive] = useState(true);
  const [rx, setRx] = useState<{ t: number; v: number }[]>([]);
  const [tx, setTx] = useState<{ t: number; v: number }[]>([]);
  const [optics, setOptics] = useState<OpticsResp | null>(null);
  const [poe, setPoe] = useState<PoeResp | null>(null);

  const type = interfaces.find((i) => i.name === iface)?.type ?? "";
  const sfp = isSfpIface(iface, type);
  const ether = !sfp && iface.startsWith("ether");

  // Seleciona a 1ª interface assim que a lista chega.
  useEffect(() => {
    if (!iface && candidates.length) onSelect(candidates[0].name);
  }, [candidates, iface, onSelect]);

  // Reseta ao trocar de interface.
  useEffect(() => {
    setRx([]);
    setTx([]);
    setOptics(null);
    setPoe(null);
  }, [iface]);

  // Tráfego rx/tx (3s).
  useEffect(() => {
    if (!live || !iface) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const r = await rosGet<TrafficResp>(deviceId, `/traffic?iface=${encodeURIComponent(iface)}`);
        if (!alive) return;
        const t = Date.now();
        setRx((p) => [...p, { t, v: r.rx_bps }].slice(-TRAFFIC_WINDOW));
        setTx((p) => [...p, { t, v: r.tx_bps }].slice(-TRAFFIC_WINDOW));
      } catch { /* ignora amostra perdida */ }
      if (alive) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [live, iface, deviceId]);

  // Óptica (SFP) ou PoE (ether) — poll mais lento (6s).
  useEffect(() => {
    if (!iface || (!sfp && !ether)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        if (sfp) setOptics(await rosGet<OpticsResp>(deviceId, `/optics?iface=${encodeURIComponent(iface)}`));
        else setPoe(await rosGet<PoeResp>(deviceId, `/poe?iface=${encodeURIComponent(iface)}`));
      } catch { /* ignora */ }
      if (alive && live) timer = setTimeout(tick, 6000);
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [iface, sfp, ether, deviceId, live]);

  const curRx = rx.length ? rx[rx.length - 1].v : 0;
  const curTx = tx.length ? tx[tx.length - 1].v : 0;
  const peak = Math.max(0, ...rx.map((p) => p.v), ...tx.map((p) => p.v));

  return (
    <Card className="mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Live Traffic — {iface || "—"}
          {sfp && <Badge tone="accent"><Zap className="mr-0.5 inline h-3 w-3" />óptica</Badge>}
          {poe?.poe && <Badge tone="ok">PoE</Badge>}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">clique numa interface acima ou:</span>
          <select value={iface} onChange={(e) => onSelect(e.target.value)} className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs">
            {candidates.map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
          </select>
          <button onClick={() => setLive((v) => !v)} className={cn("rounded-lg border px-3 py-1 text-xs cursor-pointer", live ? "border-ok/50 bg-ok/15 text-ok" : "border-border text-muted")}>
            {live ? "● Live" : "Paused"}
          </button>
        </div>
      </div>

      {/* Painel óptico (SFP) */}
      {sfp && optics?.optical && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs sm:grid-cols-4">
          <Optic label="TX Power" value={optics.data["sfp-tx-power"]} good />
          <Optic label="RX Power" value={optics.data["sfp-rx-power"]} good />
          <Optic label="Temp" value={optics.data["sfp-temperature"]} />
          <Optic label="Voltage" value={optics.data["sfp-supply-voltage"]} />
          <Optic label="Vendor" value={optics.data["sfp-vendor-name"]} />
          <Optic label="Part" value={optics.data["sfp-vendor-part-number"]} />
          <Optic label="Wavelength" value={optics.data["sfp-wavelength"]} />
          <Optic label="Bias" value={optics.data["sfp-tx-bias-current"]} />
        </div>
      )}
      {sfp && optics && !optics.optical && <p className="mb-3 rounded-lg border border-border bg-bg/40 p-2 text-xs text-muted">Sem módulo SFP presente nesta porta.</p>}

      {/* Painel PoE (ether) */}
      {ether && poe?.poe && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-ok/30 bg-ok/5 p-3 text-xs sm:grid-cols-4">
          <Optic label="PoE Status" value={poe.data["poe-out-status"]} />
          <Optic label="Voltage" value={poe.data["poe-out-voltage"]} />
          <Optic label="Current" value={poe.data["poe-out-current"]} />
          <Optic label="Power" value={poe.data["poe-out-power"]} good />
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-4 text-xs">
        <span>RX <span className="font-mono text-ok">{fmtBps(curRx)}</span></span>
        <span>TX <span className="font-mono text-primary">{fmtBps(curTx)}</span></span>
        <span className="text-muted">Peak <span className="font-mono">{fmtBps(peak)}</span></span>
      </div>
      <LineChart
        series={[{ points: rx, color: "#22C55E", label: "RX" }, { points: tx, color: "#3B82F6", label: "TX" }]}
        format={fmtBps}
        id="traffic"
        empty={live ? "Medindo tráfego ao vivo…" : "Pausado."}
      />
    </Card>
  );
}

function Optic({ label, value, good }: { label: string; value?: string; good?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("font-mono", good ? "text-accent" : "text-text")}>{value ?? "—"}</p>
    </div>
  );
}

// === Mapa de interfaces ===

const isUp = (r: RosRecord) => r.running === "true" || (r.flags ?? "").includes("R");
const isDisabled = (r: RosRecord) => r.disabled === "true" || (r.flags ?? "").includes("X");

function Port({ r, selected, onSelect }: { r: RosRecord; selected: boolean; onSelect: (n: string) => void }) {
  const up = isUp(r);
  const off = isDisabled(r);
  const sfp = isSfpIface(r.name, r.type);
  return (
    <button onClick={() => onSelect(r.name)} className="group relative flex cursor-pointer flex-col items-center gap-1" title={sfp ? "SFP / óptica — clique p/ ver TX/RX power" : "clique p/ ver o tráfego"}>
      <div className={cn(
        "h-10 w-12 rounded-md border",
        off ? "border-border bg-surface-2 opacity-40" : up ? "border-ok/60 bg-ok/30" : "border-border bg-surface-2",
        sfp && !off && "border-accent/70 bg-accent/20",
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-bg",
      )} />
      <div className={cn("h-0.5 w-10 rounded", up ? "bg-ok" : "bg-border")} />
      <span className={cn("inline-flex items-center gap-0.5 font-mono text-[10px]", selected ? "text-primary" : sfp ? "text-accent" : "text-muted")}>
        {sfp && <Zap className="h-2.5 w-2.5" />}{r.name}
      </span>
      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-pre rounded-md border border-border bg-bg px-2 py-1 text-[11px] font-mono shadow-lg group-hover:block">
        {`${r.name} — ${off ? "disabled" : up ? "link-ok" : "down"}${sfp ? " (óptica)" : ""}${r["mac-address"] ? "\n" + r["mac-address"] : ""}`}
      </div>
    </button>
  );
}

// Categorias de interfaces virtuais (cores diferentes para diferenciar).
type VCat = "vlan" | "pppoe" | "bridge" | "bond" | "other";
const VCAT: Record<VCat, { label: string; dot: string; border: string; text: string }> = {
  vlan: { label: "VLAN", dot: "bg-purple-400", border: "border-purple-400/50", text: "text-purple-300" },
  pppoe: { label: "PPPoE", dot: "bg-orange-400", border: "border-orange-400/50", text: "text-orange-300" },
  bridge: { label: "Bridge", dot: "bg-sky-400", border: "border-sky-400/50", text: "text-sky-300" },
  bond: { label: "Bond", dot: "bg-teal-400", border: "border-teal-400/50", text: "text-teal-300" },
  other: { label: "Outras (túneis/virtuais)", dot: "bg-slate-400", border: "border-slate-500/50", text: "text-slate-300" },
};
function vcat(r: RosRecord): VCat {
  const t = (r.type ?? "").toLowerCase();
  const n = (r.name ?? "").toLowerCase();
  if (t === "vlan") return "vlan";
  if (t.includes("pppoe") || n.startsWith("pppoe") || n.startsWith("<pppoe")) return "pppoe";
  if (t === "bridge") return "bridge";
  if (t === "bond") return "bond";
  return "other";
}
const CHIP_CAP = 60;

function LogicalChip({ r, selected, onSelect, cat }: { r: RosRecord; selected: boolean; onSelect: (n: string) => void; cat: VCat }) {
  const c = VCAT[cat];
  return (
    <button onClick={() => onSelect(r.name)} className={cn("inline-flex cursor-pointer items-center gap-2 rounded-md border bg-surface-2 px-2.5 py-1 text-xs", selected ? "border-primary ring-1 ring-primary" : c.border)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", isUp(r) ? c.dot : "bg-muted")} />
      <span className={cn("font-mono font-medium", selected ? "text-primary" : c.text)}>{r.name}</span>
      {r.comment && <span className="text-muted">{r.comment}</span>}
    </button>
  );
}

function InterfaceMap({ rows, selected, onSelect }: { rows: RosRecord[]; selected: string; onSelect: (n: string) => void }) {
  const isPhysical = (r: RosRecord) => {
    const t = r.type ?? ""; const n = r.name ?? "";
    return t.includes("ether") || t.includes("sfp") || n.startsWith("ether") || n.startsWith("sfp");
  };
  const isWifi = (r: RosRecord) => {
    const t = r.type ?? ""; const n = r.name ?? "";
    return t.includes("wifi") || t.includes("wlan") || t.includes("cap") || n.startsWith("wifi") || n.startsWith("wlan");
  };
  const physical = rows.filter(isPhysical);
  const wifi = rows.filter(isWifi);
  const virtual = rows.filter((r) => !isPhysical(r) && !isWifi(r));

  return (
    <div className="space-y-5">
      {physical.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted">Ethernet / Physical <span className="text-muted/70">({physical.length})</span></p>
          <div className="flex flex-wrap gap-3">{physical.map((r, i) => <Port key={i} r={r} selected={r.name === selected} onSelect={onSelect} />)}</div>
          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded bg-surface-2 ring-1 ring-border" /> Down</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded bg-ok/40" /> Up</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded bg-accent/40" /> <Zap className="h-3 w-3 text-accent" /> SFP / óptica</span>
          </div>
        </div>
      )}
      {wifi.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted">CAPSMAN / WiFi <span className="text-muted/70">({wifi.length})</span></p>
          <div className="flex flex-wrap gap-2">{wifi.map((r, i) => <LogicalChip key={i} r={r} cat="other" selected={r.name === selected} onSelect={onSelect} />)}</div>
        </div>
      )}
      {(["vlan", "pppoe", "bridge", "bond", "other"] as VCat[]).map((k) => {
        const items = virtual.filter((r) => vcat(r) === k);
        if (items.length === 0) return null;
        const c = VCAT[k];
        return (
          <div key={k}>
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
              <span className={cn("h-2 w-2 rounded-full", c.dot)} /> {c.label} <span className="text-muted/70">({items.length})</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {items.slice(0, CHIP_CAP).map((r, i) => <LogicalChip key={i} r={r} cat={k} selected={r.name === selected} onSelect={onSelect} />)}
              {items.length > CHIP_CAP && <span className="self-center text-xs text-muted">+{items.length - CHIP_CAP} …</span>}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <p className="text-xs text-muted">Sem interfaces.</p>}
    </div>
  );
}

// === Protocolos (OSPF / MPLS / VPLS) ===

interface ProtocolsResp {
  ok: boolean;
  ospf: { active: boolean; instances: RosRecord[]; neighbors: RosRecord[] };
  mpls: { active: boolean; interfaces: RosRecord[]; ldp_neighbors: RosRecord[] };
  vpls: { active: boolean; tunnels: RosRecord[] };
}

function ProtocolsCard({ deviceId }: { deviceId: number }) {
  const res = useResource<ProtocolsResp>(`proto:${deviceId}`, () => rosGet<ProtocolsResp>(deviceId, "/protocols"));
  const d = res.data;
  return (
    <Card className="mb-5">
      <SectionHeader title="Protocolos — OSPF · MPLS · VPLS" busy={res.busy} onReload={res.reload} />
      {res.error ? (
        <ErrorNote msg={res.error} />
      ) : !d ? (
        <div className="flex justify-center py-6"><Spinner className="h-6 w-6" /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <ProtoBox
            title="OSPF" active={d.ospf.active}
            rows={[["Instâncias", d.ospf.instances.length], ["Adjacências", d.ospf.neighbors.length]]}
            detail={d.ospf.neighbors.map((n) => `${n["router-id"] || n.address} @ ${n.interface || "?"} · ${n.state || "?"}`)}
          />
          <ProtoBox
            title="MPLS" active={d.mpls.active}
            rows={[["Interfaces", d.mpls.interfaces.length], ["LDP neighbors", d.mpls.ldp_neighbors.length]]}
            detail={d.mpls.ldp_neighbors.map((n) => `${n.peer || n.transport || "?"}`)}
          />
          <ProtoBox
            title="VPLS" active={d.vpls.active}
            rows={[["Túneis", d.vpls.tunnels.length]]}
            detail={d.vpls.tunnels.map((t) => `${t.name} → ${t["remote-peer"] || "?"}`)}
          />
        </div>
      )}
    </Card>
  );
}

function ProtoBox({ title, active, rows, detail }: { title: string; active: boolean; rows: [string, number][]; detail: string[] }) {
  return (
    <div className={cn("rounded-lg border p-3", active ? "border-ok/40 bg-ok/5" : "border-border")}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">{title}</span>
        <Badge tone={active ? "ok" : "muted"}>{active ? "ativo" : "inativo"}</Badge>
      </div>
      <dl className="space-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2"><dt className="text-muted">{k}</dt><dd className="font-mono">{v}</dd></div>
        ))}
      </dl>
      {detail.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-border pt-2 font-mono text-[11px] text-muted">
          {detail.slice(0, 5).map((x, i) => <div key={i} className="truncate">{x}</div>)}
          {detail.length > 5 && <div>+{detail.length - 5}…</div>}
        </div>
      )}
    </div>
  );
}

// === Neighbors (grafo) ===

function NeighborsModal({ deviceId, deviceName, onClose }: { deviceId: number; deviceName: string; onClose: () => void }) {
  const [rows, setRows] = useState<RosRecord[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    rosGet<{ neighbors: RosRecord[] }>(deviceId, "/neighbors")
      .then((r) => setRows(r.neighbors))
      .catch((e) => setErr(errMsg(e)));
  }, [deviceId]);

  const { nodes, edges } = useMemo(() => {
    const nodes: GNode[] = [{ id: "self", label: deviceName, type: "self" }];
    const edges: GEdge[] = [];
    (rows ?? []).forEach((n, i) => {
      const id = `n${i}`;
      const label = n.identity || n.address || n["mac-address"] || "?";
      nodes.push({ id, label, type: "neighbor" });
      const port = (n.interface || "").split(",")[0] || "?"; // porta local (1ª da lista)
      edges.push({ source: "self", target: id, label: port });
    });
    return { nodes, edges };
  }, [rows, deviceName]);

  return (
    <Modal title={`Neighbors — ${deviceName}`} onClose={onClose} wide>
      {err ? (
        <ErrorNote msg={err} />
      ) : !rows ? (
        <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-muted">Nenhum vizinho anunciado (MNDP/CDP/LLDP).</p>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3B82F6" }} /> este device</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#22C55E" }} /> vizinho</span>
            <span className="ml-auto">{rows.length} vizinho(s) · a aresta = porta local · scroll: zoom · arraste nós/fundo · posição é salva</span>
          </div>
          <ForceGraph nodes={nodes} edges={edges} height={640} storageKey={`neighbors-${deviceId}`} color={(n) => (n.type === "self" ? "#3B82F6" : "#22C55E")} />
        </>
      )}
    </Modal>
  );
}

// === Abas RouterOS: IP / Firewall / DHCP / Routes ===

type Tab = "ip_addr" | "services" | "fw_filter" | "fw_nat" | "dhcp_servers" | "dhcp_leases" | "routes";
const TABS: { key: Tab; label: string }[] = [
  { key: "ip_addr", label: "IP · Addresses" },
  { key: "services", label: "Services" },
  { key: "fw_filter", label: "Firewall · Filter" },
  { key: "fw_nat", label: "Firewall · NAT" },
  { key: "dhcp_servers", label: "DHCP · Servers" },
  { key: "dhcp_leases", label: "DHCP · Leases" },
  { key: "routes", label: "Routes" },
];

const actionBadge = (v: string) => {
  const tone = v === "accept" ? "ok" : v === "drop" || v === "reject" ? "danger" : "accent";
  return <Badge tone={tone as "ok" | "danger" | "accent"}>{v || "—"}</Badge>;
};

function DeviceTabs({ deviceId }: { deviceId: number }) {
  const [tab, setTab] = useState<Tab>("ip_addr");
  const net = useResource<NetInfoResp>(`net:${deviceId}`, () => rosGet<NetInfoResp>(deviceId, "/netinfo"));
  const ifaces = ((net.data?.interfaces ?? []).map((i) => i.name).filter(Boolean) as string[]);
  const wan = new Set(net.data?.wan ?? []);
  return (
    <Card className="mb-5">
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "cursor-pointer rounded-t-lg px-4 py-2 text-sm transition-colors duration-200",
              tab === t.key ? "border-b-2 border-primary font-medium text-primary" : "text-muted hover:text-text",
            )}
          >
            {t.label}
          </button>
        ))}
        {wan.size > 0 && <span className="ml-auto text-xs text-muted">WAN: <span className="font-mono text-accent">{[...wan].join(", ")}</span></span>}
      </div>
      {tab === "ip_addr" && <IpAddressesTab deviceId={deviceId} ifaces={ifaces} wan={wan} />}
      {tab === "services" && <ServicesTab deviceId={deviceId} />}
      {tab === "fw_filter" && <FirewallTab deviceId={deviceId} kind="filter" ifaces={ifaces} wan={wan} />}
      {tab === "fw_nat" && <FirewallTab deviceId={deviceId} kind="nat" ifaces={ifaces} wan={wan} />}
      {tab === "dhcp_servers" && <DhcpServersTab deviceId={deviceId} ifaces={ifaces} wan={wan} />}
      {tab === "dhcp_leases" && <DhcpLeasesTab deviceId={deviceId} />}
      {tab === "routes" && <RoutesTab deviceId={deviceId} />}
    </Card>
  );
}

function Toolbar({ onReload, busy, children }: { onReload: () => void; busy?: boolean; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {children}
      <Button variant="ghost" className="ml-auto" onClick={onReload} disabled={busy}>
        {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Reload
      </Button>
    </div>
  );
}

const isDyn = (r: RosRecord) => r.dynamic === "true" || (r.flags ?? "").includes("D");

/** Estado compartilhado das abas de gestão: lista + escrita (post) + reload. */
function useConfigList(deviceId: number, key: string, path: string, field: string) {
  const res = useResource<Record<string, RosRecord[]>>(`${key}:${deviceId}`, () => rosGet(deviceId, path));
  const rows = (res.data?.[field] as RosRecord[] | undefined) ?? [];
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function write(subpath: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setErr("");
    try {
      await rosPost(deviceId, subpath, body);
      await res.reload();
      return true;
    } catch (e) {
      setErr(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { res, rows, err, setErr, busy, write };
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}

interface IfaceProps {
  ifaces: string[];
  wan: Set<string>;
}

function IfaceSelect({ value, onChange, ifaces, wan, allowEmpty }: IfaceProps & { value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs">
      {allowEmpty && <option value="">— qualquer —</option>}
      {value && !ifaces.includes(value) && <option value={value}>{value}</option>}
      {ifaces.map((n) => (
        <option key={n} value={n}>{n}{wan.has(n) ? "  (WAN)" : ""}</option>
      ))}
    </Select>
  );
}

function WanTag({ name, wan }: { name?: string; wan: Set<string> }) {
  return name && wan.has(name) ? <Badge tone="accent">WAN</Badge> : null;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Fld label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs">
        {options.map((o) => <option key={o} value={o}>{o || "— qualquer —"}</option>)}
      </Select>
    </Fld>
  );
}

// --- IP · Addresses ---

function IpAddressesTab({ deviceId, ifaces, wan }: { deviceId: number } & IfaceProps) {
  const { res, rows, err, busy, write } = useConfigList(deviceId, "ipaddr", "/ip/addresses", "addresses");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ address: "", interface: "", comment: "" });

  async function add() {
    if (await write("/ip/addresses/add", form)) {
      setOpen(false);
      setForm({ address: "", interface: "", comment: "" });
    }
  }
  const toggle = (r: RosRecord) => write("/ip/addresses/toggle", { address: r.address, interface: r.interface, disable: !isDisabled(r) });
  const remove = (r: RosRecord) => confirm(`Remover ${r.address} de ${r.interface}?`) && write("/ip/addresses/remove", { address: r.address, interface: r.interface });

  return (
    <div>
      <Toolbar onReload={res.reload} busy={res.busy || busy}>
        <Button onClick={() => setOpen(true)}><Play className="h-3.5 w-3.5" /> Add address</Button>
      </Toolbar>
      {err && <ErrorNote msg={err} />}
      {res.busy && !res.data ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : res.error ? (
        <ErrorNote msg={res.error} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-xs text-muted">Sem endereços IP.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table head={<><Th>Address</Th><Th>Network</Th><Th>Interface</Th><Th>Comment</Th><Th className="text-right">Ações</Th></>}>
            {rows.map((r, i) => (
              <tr key={i} className={cn("hover:bg-surface-2", isDisabled(r) && "opacity-50")}>
                <Td className="font-mono">{r.address}</Td>
                <Td className="font-mono text-muted">{r.network ?? "—"}</Td>
                <Td className="font-mono"><span className="inline-flex items-center gap-1">{r.interface} <WanTag name={r.interface} wan={wan} />{isDyn(r) && <Badge tone="muted">dynamic</Badge>}</span></Td>
                <Td className="text-xs text-muted">{r.comment ?? ""}</Td>
                <Td className="text-right">
                  {isDyn(r) ? (
                    <span className="text-xs text-muted">—</span>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => toggle(r)} disabled={busy}>{isDisabled(r) ? "Enable" : "Disable"}</Button>
                      <Button variant="danger" onClick={() => remove(r)} disabled={busy}>Remove</Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {open && (
        <Modal
          title="Add IP address"
          onClose={() => setOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={add} disabled={busy || !form.address || !form.interface}>{busy ? "…" : "Add"}</Button></>}
        >
          <div className="space-y-3">
            <Fld label="ADDRESS (CIDR)"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="192.168.88.1/24" className="font-mono" autoFocus /></Fld>
            <Fld label="INTERFACE"><IfaceSelect value={form.interface} onChange={(v) => setForm({ ...form, interface: v })} ifaces={ifaces} wan={wan} allowEmpty /></Fld>
            <Fld label="COMMENT"><Input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder="opcional" /></Fld>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- IP · Services (/ip service) ---

function ServicesTab({ deviceId }: { deviceId: number }) {
  const { res, rows, err, busy, write } = useConfigList(deviceId, "services", "/ip/services", "services");
  const [edit, setEdit] = useState<RosRecord | null>(null);
  const [form, setForm] = useState({ port: "", address: "" });

  function openEdit(r: RosRecord) {
    setForm({ port: r.port ?? "", address: r.address ?? "" });
    setEdit(r);
  }
  async function save() {
    if (!edit) return;
    const body: { name: string; port?: number; address: string } = { name: edit.name, address: form.address.trim() };
    if (form.port) body.port = Number(form.port);
    if (await write("/ip/services/set", body)) setEdit(null);
  }
  const toggle = (r: RosRecord) => write("/ip/services/toggle", { name: r.name, disable: !isDisabled(r) });

  return (
    <div>
      <Toolbar onReload={res.reload} busy={res.busy || busy} />
      {err && <ErrorNote msg={err} />}
      <p className="mb-3 text-xs text-muted">
        Serviços de acesso ao roteador (<span className="font-mono">/ip service</span>). Desative os inseguros
        (<span className="text-accent">telnet, ftp, www, api</span>) e restrinja o acesso por rede em <em>Available From</em>.
      </p>
      {res.busy && !res.data ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : res.error ? (
        <ErrorNote msg={res.error} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-xs text-muted">Sem serviços.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table head={<><Th>Service</Th><Th>Port</Th><Th>Available From</Th><Th>Certificate</Th><Th>Status</Th><Th className="text-right">Ações</Th></>}>
            {rows.map((r, i) => {
              const off = isDisabled(r);
              const insecure = INSECURE.has(r.name ?? "");
              return (
                <tr key={i} className={cn("hover:bg-surface-2", off && "opacity-50")}>
                  <Td className="font-mono">
                    <span className="inline-flex items-center gap-1.5">
                      {r.name}
                      {insecure && !off && <Badge tone="accent">inseguro</Badge>}
                    </span>
                  </Td>
                  <Td className="font-mono">{r.port ?? "—"}</Td>
                  <Td className="font-mono text-xs text-muted">{r.address || "qualquer"}</Td>
                  <Td className="font-mono text-xs text-muted">{r.certificate && r.certificate !== "none" ? r.certificate : "—"}</Td>
                  <Td><Badge tone={off ? "muted" : "ok"}>{off ? "disabled" : "enabled"}</Badge></Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => openEdit(r)} disabled={busy}>Edit</Button>
                      <Button variant="ghost" onClick={() => toggle(r)} disabled={busy}>{off ? "Enable" : "Disable"}</Button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}

      {edit && (
        <Modal
          title={`Editar serviço "${edit.name}"`}
          onClose={() => setEdit(null)}
          footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "…" : "Salvar"}</Button></>}
        >
          <div className="space-y-3">
            <Fld label="PORT"><Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="ex.: 22" className="font-mono" inputMode="numeric" /></Fld>
            <Fld label="AVAILABLE FROM (redes permitidas)"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="ex.: 10.0.0.0/8,192.168.0.0/16 (vazio = qualquer)" className="font-mono text-xs" /></Fld>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- DHCP · Servers ---

function DhcpServersTab({ deviceId, ifaces, wan }: { deviceId: number } & IfaceProps) {
  const { res, rows, err, busy, write } = useConfigList(deviceId, "dhcpsrv", "/dhcp/servers", "servers");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", interface: "", address_pool: "", lease_time: "" });

  async function add() {
    if (await write("/dhcp/servers/add", form)) {
      setOpen(false);
      setForm({ name: "", interface: "", address_pool: "", lease_time: "" });
    }
  }
  const toggle = (r: RosRecord) => write("/dhcp/servers/toggle", { name: r.name, disable: !isDisabled(r) });
  const remove = (r: RosRecord) => confirm(`Remover o DHCP server "${r.name}"?`) && write("/dhcp/servers/remove", { name: r.name });

  return (
    <div>
      <Toolbar onReload={res.reload} busy={res.busy || busy}>
        <Button onClick={() => setOpen(true)}><Play className="h-3.5 w-3.5" /> Add server</Button>
      </Toolbar>
      {err && <ErrorNote msg={err} />}
      {res.busy && !res.data ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : res.error ? (
        <ErrorNote msg={res.error} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-xs text-muted">Sem servidores DHCP.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table head={<><Th>Name</Th><Th>Interface</Th><Th>Pool</Th><Th>Lease</Th><Th className="text-right">Ações</Th></>}>
            {rows.map((r, i) => (
              <tr key={i} className={cn("hover:bg-surface-2", isDisabled(r) && "opacity-50")}>
                <Td className="font-medium">{r.name}</Td>
                <Td className="font-mono"><span className="inline-flex items-center gap-1">{r.interface} <WanTag name={r.interface} wan={wan} /></span></Td>
                <Td className="font-mono text-muted">{r["address-pool"] ?? "—"}</Td>
                <Td className="font-mono text-muted">{r["lease-time"] ?? "—"}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" onClick={() => toggle(r)} disabled={busy}>{isDisabled(r) ? "Enable" : "Disable"}</Button>
                    <Button variant="danger" onClick={() => remove(r)} disabled={busy}>Remove</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {open && (
        <Modal
          title="Add DHCP server"
          onClose={() => setOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={add} disabled={busy || !form.name || !form.interface}>{busy ? "…" : "Add"}</Button></>}
        >
          <div className="space-y-3">
            <Fld label="NAME"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="font-mono" autoFocus /></Fld>
            <Fld label="INTERFACE"><IfaceSelect value={form.interface} onChange={(v) => setForm({ ...form, interface: v })} ifaces={ifaces} wan={wan} allowEmpty /></Fld>
            <Fld label="ADDRESS POOL"><Input value={form.address_pool} onChange={(e) => setForm({ ...form, address_pool: e.target.value })} placeholder="opcional (ex.: dhcp_pool0)" className="font-mono" /></Fld>
            <Fld label="LEASE TIME"><Input value={form.lease_time} onChange={(e) => setForm({ ...form, lease_time: e.target.value })} placeholder="opcional (ex.: 30m, 1d)" className="font-mono" /></Fld>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- DHCP · Leases ---

function DhcpLeasesTab({ deviceId }: { deviceId: number }) {
  const { res, rows, err, busy, write } = useConfigList(deviceId, "dhcplease", "/dhcp/leases", "leases");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ address: "", mac_address: "", server: "" });

  async function add() {
    if (await write("/dhcp/leases/add", form)) {
      setOpen(false);
      setForm({ address: "", mac_address: "", server: "" });
    }
  }
  const makeStatic = (r: RosRecord) => write("/dhcp/leases/make-static", { address: r.address });
  const remove = (r: RosRecord) => confirm(`Remover a lease ${r.address}?`) && write("/dhcp/leases/remove", { address: r.address });

  return (
    <div>
      <Toolbar onReload={res.reload} busy={res.busy || busy}>
        <Button onClick={() => setOpen(true)}><Play className="h-3.5 w-3.5" /> Add static lease</Button>
      </Toolbar>
      {err && <ErrorNote msg={err} />}
      {res.busy && !res.data ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : res.error ? (
        <ErrorNote msg={res.error} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-xs text-muted">Sem leases.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table head={<><Th>Address</Th><Th>MAC</Th><Th>Host</Th><Th>Status</Th><Th>Server</Th><Th className="text-right">Ações</Th></>}>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-surface-2">
                <Td className="font-mono">{r.address}</Td>
                <Td className="font-mono text-xs">{r["mac-address"] ?? "—"}</Td>
                <Td className="text-xs">{r["host-name"] ?? "—"}</Td>
                <Td><Badge tone={r.status === "bound" ? "ok" : "muted"}>{r.status || "—"}</Badge>{isDyn(r) && <Badge tone="muted">dynamic</Badge>}</Td>
                <Td className="font-mono text-muted">{r.server ?? "—"}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    {isDyn(r) && <Button variant="ghost" onClick={() => makeStatic(r)} disabled={busy}>Make static</Button>}
                    <Button variant="danger" onClick={() => remove(r)} disabled={busy}>Remove</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {open && (
        <Modal
          title="Add static lease"
          onClose={() => setOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={add} disabled={busy || !form.address || !form.mac_address}>{busy ? "…" : "Add"}</Button></>}
        >
          <div className="space-y-3">
            <Fld label="ADDRESS (IP)"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="192.168.88.10" className="font-mono" autoFocus /></Fld>
            <Fld label="MAC ADDRESS"><Input value={form.mac_address} onChange={(e) => setForm({ ...form, mac_address: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" className="font-mono" /></Fld>
            <Fld label="SERVER"><Input value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} placeholder="opcional (ex.: defconf)" className="font-mono" /></Fld>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Firewall (filter / nat) com escrita ---

const CHAINS = { filter: ["input", "forward", "output"], nat: ["srcnat", "dstnat"] };
const ACTIONS = {
  filter: ["accept", "drop", "reject", "log", "tarpit", "fasttrack-connection", "jump", "return"],
  nat: ["masquerade", "dst-nat", "src-nat", "redirect", "netmap", "accept", "drop", "return"],
};
const PROTOCOLS = ["", "tcp", "udp", "icmp", "icmpv6", "gre", "ipsec-esp", "ipsec-ah"];

function FirewallTab({ deviceId, kind, ifaces, wan }: { deviceId: number; kind: "filter" | "nat" } & IfaceProps) {
  const { res, rows, err, busy, write } = useConfigList(deviceId, `fw_${kind}`, `/firewall/${kind}`, "rules");
  const [open, setOpen] = useState(false);
  const blank = {
    chain: kind === "nat" ? "srcnat" : "forward",
    action: kind === "nat" ? "masquerade" : "accept",
    protocol: "", src_address: "", dst_address: "", dst_port: "", to_addresses: "", to_ports: "",
    in_interface: "", out_interface: "", comment: "",
  };
  const [form, setForm] = useState<Record<string, string>>(blank);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function add() {
    if (await write(`/firewall/${kind}/add`, form)) {
      setOpen(false);
      setForm(blank);
    }
  }
  const toggle = (r: RosRecord) => write(`/firewall/${kind}/toggle`, { number: Number(r["#"]), disable: !isDisabled(r) });
  const remove = (r: RosRecord) => confirm(`Remover a regra #${r["#"]} (${r.chain}/${r.action})?`) && write(`/firewall/${kind}/remove`, { number: Number(r["#"]) });

  const ifaceCell = (r: RosRecord) => {
    const parts: React.ReactNode[] = [];
    if (r["in-interface"]) parts.push(<span key="in" className="inline-flex items-center gap-0.5">in:{r["in-interface"]}<WanTag name={r["in-interface"]} wan={wan} /></span>);
    if (r["out-interface"]) parts.push(<span key="out" className="inline-flex items-center gap-0.5">out:{r["out-interface"]}<WanTag name={r["out-interface"]} wan={wan} /></span>);
    return parts.length ? <span className="flex flex-wrap gap-x-2">{parts}</span> : "—";
  };

  return (
    <div>
      <Toolbar onReload={res.reload} busy={res.busy || busy}>
        <Button onClick={() => setOpen(true)}><Play className="h-3.5 w-3.5" /> Add rule</Button>
      </Toolbar>
      {err && <ErrorNote msg={err} />}
      {res.busy && !res.data ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : res.error ? (
        <ErrorNote msg={res.error} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-xs text-muted">Sem regras estáticas.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table head={<><Th>#</Th><Th>Chain</Th><Th>Action</Th><Th>Proto</Th><Th>Src</Th><Th>Dst</Th><Th>Interfaces</Th><Th>Extra</Th><Th className="text-right">Ações</Th></>}>
            {rows.map((r, i) => (
              <tr key={i} className={cn("hover:bg-surface-2", isDisabled(r) && "opacity-50")}>
                <Td className="font-mono text-muted">{r["#"]}</Td>
                <Td>{r.chain}</Td>
                <Td>{actionBadge(r.action)}</Td>
                <Td className="font-mono text-xs">{r.protocol ?? "—"}</Td>
                <Td className="font-mono text-xs">{r["src-address"] ?? "—"}</Td>
                <Td className="font-mono text-xs">{r["dst-address"] ?? "—"}</Td>
                <Td className="font-mono text-xs text-muted">{ifaceCell(r)}</Td>
                <Td className="font-mono text-xs text-muted">{kind === "nat" ? (r["to-addresses"] || r["to-ports"] || "—") : (r["dst-port"] || "—")}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" onClick={() => toggle(r)} disabled={busy}>{isDisabled(r) ? "Enable" : "Disable"}</Button>
                    <Button variant="danger" onClick={() => remove(r)} disabled={busy}>Remove</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {open && (
        <Modal
          title={`Add ${kind} rule`}
          onClose={() => setOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={add} disabled={busy || !form.chain || !form.action}>{busy ? "…" : "Add"}</Button></>}
        >
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Chain" value={form.chain} onChange={(v) => set("chain", v)} options={CHAINS[kind]} />
            <SelectField label="Action" value={form.action} onChange={(v) => set("action", v)} options={ACTIONS[kind]} />
            <SelectField label="Protocol" value={form.protocol} onChange={(v) => set("protocol", v)} options={PROTOCOLS} />
            <Fld label="Src address"><Input value={form.src_address} onChange={(e) => set("src_address", e.target.value)} className="font-mono text-xs" placeholder="0.0.0.0/0" /></Fld>
            <Fld label="Dst address"><Input value={form.dst_address} onChange={(e) => set("dst_address", e.target.value)} className="font-mono text-xs" placeholder="0.0.0.0/0" /></Fld>
            {kind === "filter" ? (
              <Fld label="Dst port"><Input value={form.dst_port} onChange={(e) => set("dst_port", e.target.value)} className="font-mono text-xs" placeholder="80,443" /></Fld>
            ) : (
              <>
                <Fld label="To addresses"><Input value={form.to_addresses} onChange={(e) => set("to_addresses", e.target.value)} className="font-mono text-xs" /></Fld>
                <Fld label="To ports"><Input value={form.to_ports} onChange={(e) => set("to_ports", e.target.value)} className="font-mono text-xs" /></Fld>
              </>
            )}
            {kind === "filter" && (
              <Fld label="In interface"><IfaceSelect value={form.in_interface} onChange={(v) => set("in_interface", v)} ifaces={ifaces} wan={wan} allowEmpty /></Fld>
            )}
            <Fld label="Out interface"><IfaceSelect value={form.out_interface} onChange={(v) => set("out_interface", v)} ifaces={ifaces} wan={wan} allowEmpty /></Fld>
            <Fld label="Comment"><Input value={form.comment} onChange={(e) => set("comment", e.target.value)} className="text-xs" /></Fld>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Rotas estáticas com escrita ---

function RoutesTab({ deviceId }: { deviceId: number }) {
  const { res, rows, err, busy, write } = useConfigList(deviceId, "routes", "/routes", "routes");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ dst_address: "", gateway: "", distance: "", comment: "" });

  async function add() {
    if (await write("/routes/add", form)) {
      setOpen(false);
      setForm({ dst_address: "", gateway: "", distance: "", comment: "" });
    }
  }
  const remove = (r: RosRecord) => confirm(`Remover a rota ${r["dst-address"]} via ${r.gateway}?`) && write("/routes/remove", { dst_address: r["dst-address"], gateway: r.gateway });

  return (
    <div>
      <Toolbar onReload={res.reload} busy={res.busy || busy}>
        <Button onClick={() => setOpen(true)}><Play className="h-3.5 w-3.5" /> Add route</Button>
      </Toolbar>
      {err && <ErrorNote msg={err} />}
      {res.busy && !res.data ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : res.error ? (
        <ErrorNote msg={res.error} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-xs text-muted">Sem rotas.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table head={<><Th>Flags</Th><Th>Dst</Th><Th>Gateway</Th><Th>Dist</Th><Th>Comment</Th><Th className="text-right">Ações</Th></>}>
            {rows.map((r, i) => {
              const removable = !isDyn(r) && r["dst-address"] && r.gateway;
              return (
                <tr key={i} className="hover:bg-surface-2">
                  <Td className="font-mono text-xs text-muted">{r.flags}</Td>
                  <Td className="font-mono text-xs">{r["dst-address"]}</Td>
                  <Td className="font-mono text-xs">{r.gateway ?? "—"}</Td>
                  <Td className="font-mono text-xs text-muted">{r.distance ?? "—"}</Td>
                  <Td className="text-xs text-muted">{r.comment ?? ""}</Td>
                  <Td className="text-right">
                    {removable ? (
                      <Button variant="danger" onClick={() => remove(r)} disabled={busy}>Remove</Button>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}

      {open && (
        <Modal
          title="Add static route"
          onClose={() => setOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={add} disabled={busy || !form.dst_address || !form.gateway}>{busy ? "…" : "Add"}</Button></>}
        >
          <div className="space-y-3">
            <Fld label="DST-ADDRESS (CIDR)"><Input value={form.dst_address} onChange={(e) => setForm({ ...form, dst_address: e.target.value })} placeholder="10.0.0.0/24" className="font-mono" autoFocus /></Fld>
            <Fld label="GATEWAY"><Input value={form.gateway} onChange={(e) => setForm({ ...form, gateway: e.target.value })} placeholder="192.168.88.1 ou ether1" className="font-mono" /></Fld>
            <Fld label="DISTANCE"><Input value={form.distance} onChange={(e) => setForm({ ...form, distance: e.target.value })} placeholder="opcional (ex.: 1)" className="font-mono" /></Fld>
            <Fld label="COMMENT"><Input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder="opcional" /></Fld>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CommandPanel({ deviceId }: { deviceId: number }) {
  const [command, setCommand] = useState("/system/resource/print");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setOut("");
    try {
      const r = await api.post<{ output: string }>(`/devices/${deviceId}/exec`, { command, protocol: "ssh" });
      setOut(r.output || "(sem saída)");
    } catch (e) {
      setOut(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">Command (somente leitura)</h2>
      <div className="flex gap-2">
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && command && run()}
          placeholder="ex.: /ip/address/print"
          className="font-mono"
        />
        <Button onClick={run} disabled={busy || !command}>
          {busy ? <Spinner /> : <Play className="h-4 w-4" />} Run
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">Comandos de escrita são recusados pela allowlist.</p>
      {out && (
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-xs whitespace-pre-wrap">
          {out}
        </pre>
      )}
    </Card>
  );
}
