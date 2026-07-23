import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Router } from "lucide-react";
import { api } from "@/lib/api";
import { rosGet } from "@/lib/rosClient";
import type { Device, Group, NeighborsResp, RosRecord, RosSystem, SystemResp } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";

interface NodeStat {
  busy: boolean;
  s?: RosSystem;
  online?: boolean;
}

// Layout em grade: largura/altura de célula e do card.
const CELL_W = 320;
const CELL_H = 180;
const CARD_W = 280;
const CARD_H = 120;
const GHOST_W = 210;
const GHOST_H = 96;

function gridPos(i: number, cols: number) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: col * CELL_W + 20, y: row * CELL_H + 20 };
}

export function Topology() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [site, setSite] = useState<string>("");
  const [stats, setStats] = useState<Record<number, NodeStat>>({});
  const [neighbors, setNeighbors] = useState<Record<number, RosRecord[]>>({});
  const [showUnmanaged, setShowUnmanaged] = useState(true);

  async function probe(d: Device) {
    if (d.device_type !== "routeros") return;
    setStats((m) => ({ ...m, [d.id]: { busy: true } }));
    try {
      const r = await rosGet<SystemResp>(d.id, "/system");
      setStats((m) => ({ ...m, [d.id]: { busy: false, s: r.summary, online: true } }));
    } catch {
      setStats((m) => ({ ...m, [d.id]: { busy: false, online: false } }));
    }
    try {
      const n = await rosGet<NeighborsResp>(d.id, "/neighbors");
      setNeighbors((m) => ({ ...m, [d.id]: n.neighbors }));
    } catch {
      /* sem vizinhos */
    }
  }

  function load() {
    Promise.all([api.get<Device[]>("/devices"), api.get<Group[]>("/groups")]).then(([d, g]) => {
      setDevices(d);
      setGroups(g);
      d.forEach(probe);
    });
  }
  useEffect(load, []);

  const shown = useMemo(
    () => (site ? devices.filter((d) => String(d.group_id) === site) : devices),
    [devices, site],
  );

  // Índice para casar vizinho → device gerenciado (por IP ou identity/nome).
  const byIp = useMemo(() => new Map(shown.map((d) => [d.ip, d])), [shown]);
  const byName = useMemo(() => new Map(shown.map((d) => [d.name.toLowerCase(), d])), [shown]);

  // Arestas gerenciadas + nós não-gerenciados.
  const { edges, ghosts, ghostEdges, links } = useMemo(() => {
    const edgeSet = new Set<string>();
    const edges: [number, number][] = [];
    const ghostMap = new Map<string, { key: string; label: string; sub: string; board: string; version: string }>();
    const ghostEdges: [number, string][] = [];

    for (const d of shown) {
      for (const n of neighbors[d.id] ?? []) {
        const ip = n.address || n["address4"] || "";
        const ident = (n.identity || "").toLowerCase();
        const match = byIp.get(ip) || (ident ? byName.get(ident) : undefined);
        if (match && match.id !== d.id) {
          const key = [d.id, match.id].sort((a, b) => a - b).join("-");
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push([d.id, match.id]);
          }
        } else if (!match) {
          const gkey = n["mac-address"] || ip || ident || `${d.id}-${n["#"]}`;
          if (!ghostMap.has(gkey)) {
            ghostMap.set(gkey, {
              key: gkey,
              label: n.identity || ip || n["mac-address"] || t("ops:topology.unknown"),
              sub: n.platform || n.interface || "",
              board: n.board || n["board-name"] || "",
              version: n.version || "",
            });
          }
          ghostEdges.push([d.id, gkey]);
        }
      }
    }
    return { edges, ghosts: [...ghostMap.values()], ghostEdges, links: edges.length };
  }, [shown, neighbors, byIp, byName, t]);

  // Posições: devices gerenciados primeiro, depois ghosts (se visíveis).
  const ghostList = showUnmanaged ? ghosts : [];
  const total = shown.length + ghostList.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.ceil(total / cols);
  const width = cols * CELL_W;
  const height = rows * CELL_H;

  const devPos = new Map<number, { x: number; y: number }>();
  shown.forEach((d, i) => devPos.set(d.id, gridPos(i, cols)));
  const ghostPos = new Map<string, { x: number; y: number }>();
  ghostList.forEach((g, i) => ghostPos.set(g.key, gridPos(shown.length + i, cols)));

  const center = (p: { x: number; y: number }, w: number, h: number) => ({ x: p.x + w / 2, y: p.y + h / 2 });

  return (
    <div>
      <PageHeader
        title={t("ops:topology.title")}
        actions={
          <div className="flex items-center gap-2">
            <Select value={site} onChange={(e) => setSite(e.target.value)} className="w-44">
              <option value="">{t("ops:topology.allSites")}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <button onClick={() => setShowUnmanaged((v) => !v)} className={cn("rounded-lg border px-3 py-2 text-sm cursor-pointer", showUnmanaged ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted")}>
              {t("ops:topology.unmanaged")}: {showUnmanaged ? t("common:labels.yes") : t("common:labels.no")}
            </button>
            <button onClick={() => shown.forEach(probe)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2 cursor-pointer">
              <RefreshCw className="h-4 w-4" /> {t("common:actions.refresh")}
            </button>
          </div>
        }
      />
      <p className="mb-4 text-xs text-muted">{t("ops:topology.counts", { devices: shown.length, ghosts: ghosts.length, links })}</p>

      <div className="overflow-auto rounded-lg border border-border bg-surface/40 p-2">
        <div className="relative" style={{ width, height, minWidth: "100%" }}>
          {/* Arestas */}
          <svg className="absolute inset-0" width={width} height={height} style={{ pointerEvents: "none" }}>
            {edges.map(([a, b], i) => {
              const pa = devPos.get(a);
              const pb = devPos.get(b);
              if (!pa || !pb) return null;
              const ca = center(pa, CARD_W, CARD_H);
              const cb = center(pb, CARD_W, CARD_H);
              return <line key={`e${i}`} x1={ca.x} y1={ca.y} x2={cb.x} y2={cb.y} stroke="#3B82F6" strokeWidth="2" />;
            })}
            {showUnmanaged &&
              ghostEdges.map(([a, g], i) => {
                const pa = devPos.get(a);
                const pg = ghostPos.get(g);
                if (!pa || !pg) return null;
                const ca = center(pa, CARD_W, CARD_H);
                const cg = center(pg, GHOST_W, GHOST_H);
                return <line key={`g${i}`} x1={ca.x} y1={ca.y} x2={cg.x} y2={cg.y} stroke="#475569" strokeWidth="1.5" strokeDasharray="4 4" />;
              })}
          </svg>

          {/* Nós gerenciados */}
          {shown.map((d) => {
            const p = devPos.get(d.id)!;
            const st = stats[d.id];
            const online = st?.online;
            return (
              <div
                key={d.id}
                className={cn("absolute rounded-xl border-2 bg-surface p-3", online === true ? "border-ok/60" : online === false ? "border-danger/50" : "border-border")}
                style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
              >
                <div className="flex items-center gap-2">
                  <Router className="h-7 w-7 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{d.name}</p>
                    <p className="truncate font-mono text-xs text-muted">{st?.s?.board ?? d.device_type}</p>
                  </div>
                  <span className={cn("h-3 w-3 rounded-full", online === true ? "bg-ok" : online === false ? "bg-danger" : "bg-muted")} />
                </div>
                <div className="mt-2 border-t border-border pt-2 font-mono text-xs text-muted">
                  <div className="flex flex-wrap gap-x-3">
                    <span className="text-text">{d.ip}</span>
                    <span>CPU {st?.s?.cpu_load != null ? `${st.s.cpu_load}%` : "—"}</span>
                    <span>RAM {st?.s?.ram_used_pct != null ? `${st.s.ram_used_pct}%` : "—"}</span>
                  </div>
                  <div className="mt-0.5">{st?.s?.uptime ?? "—"}</div>
                </div>
              </div>
            );
          })}

          {/* Nós não-gerenciados (ghosts) */}
          {ghostList.map((g) => {
            const p = ghostPos.get(g.key)!;
            return (
              <div key={g.key} className="absolute rounded-lg border border-dashed border-border bg-surface-2/60 p-2" style={{ left: p.x, top: p.y, width: GHOST_W, height: GHOST_H }}>
                <p className="truncate text-sm">{g.label}</p>
                <p className="truncate font-mono text-[11px] text-muted">{g.sub || t("ops:topology.unmanagedNode")}</p>
                {g.board && <p className="truncate font-mono text-[11px] text-muted">board: <span className="text-text">{g.board}</span></p>}
                {g.version && <p className="truncate font-mono text-[11px] text-muted">ver: <span className="text-text">{g.version}</span></p>}
              </div>
            );
          })}

          {total === 0 && <p className="p-6 text-sm text-muted">{t("ops:topology.empty")}</p>}
        </div>
      </div>
    </div>
  );
}
