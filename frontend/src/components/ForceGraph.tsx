import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface GNode {
  id: string;
  label: string;
  type: string;
}
export interface GEdge {
  source: string;
  target: string;
  kind?: string;
  label?: string;
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

/**
 * Grafo force-directed (estilo neo4j) sem dependências: repulsão entre nós,
 * molas nas arestas, gravidade ao centro; nós arrastáveis. Zoom com o scroll do
 * mouse, pan arrastando o fundo. Se `storageKey` for passado, as posições dos
 * nós movidos são salvas (localStorage) e restauradas (nós movidos ficam fixos).
 */
export function ForceGraph({
  nodes,
  edges,
  height = 460,
  color,
  storageKey,
}: {
  nodes: GNode[];
  edges: GEdge[];
  height?: number;
  color: (n: GNode) => string;
  storageKey?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  const pos = useRef<Map<string, P>>(new Map());
  const drag = useRef<string | null>(null);
  const pan = useRef<{ vx: number; vy: number; tx: number; ty: number } | null>(null);
  const view = useRef({ scale: 1, tx: 0, ty: 0 });
  const alpha = useRef(1);
  const [, tick] = useState(0);
  const render = () => tick((v) => (v + 1) % 1_000_000);

  const lsKey = storageKey ? `fg:${storageKey}` : null;
  const saved = () => {
    if (!lsKey) return {} as Record<string, { x: number; y: number }>;
    try { return JSON.parse(localStorage.getItem(lsKey) || "{}"); } catch { return {}; }
  };
  const persist = () => {
    if (!lsKey) return;
    const obj: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of pos.current) if (p.fixed) obj[id] = { x: p.x, y: p.y };
    try { localStorage.setItem(lsKey, JSON.stringify(obj)); } catch { /* quota */ }
  };

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const set = () => setWidth(el.clientWidth || 800);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => ro.disconnect();
  }, []);

  // (Re)inicializa posições quando o conjunto de nós muda (restaura salvas).
  useEffect(() => {
    const m = pos.current;
    const store = saved();
    const ids = new Set(nodes.map((n) => n.id));
    for (const k of [...m.keys()]) if (!ids.has(k)) m.delete(k);
    nodes.forEach((n, i) => {
      if (!m.has(n.id)) {
        const s = store[n.id];
        if (s) m.set(n.id, { x: s.x, y: s.y, vx: 0, vy: 0, fixed: true });
        else {
          const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
          m.set(n.id, { x: width / 2 + Math.cos(a) * 140, y: height / 2 + Math.sin(a) * 140, vx: 0, vy: 0 });
        }
      }
    });
    alpha.current = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  useEffect(() => {
    let raf = 0;
    const step = () => {
      const m = pos.current;
      const a = alpha.current;
      for (let i = 0; i < nodes.length; i++) {
        const pi = m.get(nodes[i].id);
        if (!pi) continue;
        let fx = 0;
        let fy = 0;
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const pj = m.get(nodes[j].id);
          if (!pj) continue;
          const dx = pi.x - pj.x;
          const dy = pi.y - pj.y;
          const d2 = dx * dx + dy * dy || 0.01;
          const d = Math.sqrt(d2);
          const rep = 7000 / d2;
          fx += (dx / d) * rep;
          fy += (dy / d) * rep;
        }
        fx += (width / 2 - pi.x) * 0.02;
        fy += (height / 2 - pi.y) * 0.02;
        pi.vx = (pi.vx + fx * a) * 0.85;
        pi.vy = (pi.vy + fy * a) * 0.85;
      }
      for (const e of edges) {
        const s = m.get(e.source);
        const t = m.get(e.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const k = (d - 95) * 0.04 * a;
        const ux = dx / d;
        const uy = dy / d;
        s.vx += ux * k;
        s.vy += uy * k;
        t.vx -= ux * k;
        t.vy -= uy * k;
      }
      for (const n of nodes) {
        const p = m.get(n.id);
        if (!p || p.fixed) continue;
        p.x = Math.max(24, Math.min(width - 24, p.x + p.vx));
        p.y = Math.max(24, Math.min(height - 24, p.y + p.vy));
      }
      alpha.current = Math.max(0.02, a * 0.994);
      render();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, width, height]);

  // Coordenadas do viewport (espaço do SVG) a partir do evento de ponteiro.
  const vp = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { vx: ((clientX - rect.left) / rect.width) * width, vy: ((clientY - rect.top) / rect.height) * height };
  };
  // Viewport → mundo (desfaz zoom/pan).
  const toWorld = (vx: number, vy: number) => ({ x: (vx - view.current.tx) / view.current.scale, y: (vy - view.current.ty) / view.current.scale });

  // Zoom com scroll — listener nativo (não-passivo) p/ poder preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { vx, vy } = vp(e.clientX, e.clientY);
      const s0 = view.current.scale;
      const s1 = Math.max(0.25, Math.min(4, s0 * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const wx = (vx - view.current.tx) / s0;
      const wy = (vy - view.current.ty) / s0;
      view.current.tx = vx - wx * s1;
      view.current.ty = vy - wy * s1;
      view.current.scale = s1;
      render();
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  function onSvgDown(e: React.PointerEvent<SVGSVGElement>) {
    // clique no fundo → inicia pan (nós fazem stopPropagation).
    const { vx, vy } = vp(e.clientX, e.clientY);
    pan.current = { vx, vy, tx: view.current.tx, ty: view.current.ty };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (drag.current) {
      const p = pos.current.get(drag.current);
      if (!p) return;
      const { vx, vy } = vp(e.clientX, e.clientY);
      const w = toWorld(vx, vy);
      p.x = w.x;
      p.y = w.y;
      alpha.current = Math.max(alpha.current, 0.4);
    } else if (pan.current) {
      const { vx, vy } = vp(e.clientX, e.clientY);
      view.current.tx = pan.current.tx + (vx - pan.current.vx);
      view.current.ty = pan.current.ty + (vy - pan.current.vy);
      render();
    }
  }
  function onUp() {
    if (drag.current) {
      const p = pos.current.get(drag.current);
      if (p) {
        if (lsKey) { p.fixed = true; persist(); } // fica onde foi solto (persistido)
        else p.fixed = false;
      }
    }
    drag.current = null;
    pan.current = null;
  }

  function resetView() {
    view.current = { scale: 1, tx: 0, ty: 0 };
    render();
  }
  function resetLayout() {
    if (lsKey) try { localStorage.removeItem(lsKey); } catch { /* */ }
    for (const p of pos.current.values()) p.fixed = false;
    alpha.current = 1;
    resetView();
  }

  const m = pos.current;
  const { scale, tx, ty } = view.current;
  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-lg border border-border bg-bg">
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <ZoomBtn onClick={() => { view.current.scale = Math.min(4, scale * 1.2); render(); }}>+</ZoomBtn>
        <ZoomBtn onClick={() => { view.current.scale = Math.max(0.25, scale / 1.2); render(); }}>−</ZoomBtn>
        <ZoomBtn onClick={resetView} title="Centralizar/zoom 100%">⌂</ZoomBtn>
        <ZoomBtn onClick={resetLayout} title="Rearranjar (limpa posições salvas)">⟲</ZoomBtn>
      </div>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onPointerDown={onSvgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        className="touch-none select-none"
        style={{ cursor: pan.current ? "grabbing" : "default" }}
      >
        <g transform={`translate(${tx},${ty}) scale(${scale})`}>
          {edges.map((e, i) => {
            const s = m.get(e.source);
            const t = m.get(e.target);
            if (!s || !t) return null;
            const link = e.kind === "link";
            return (
              <g key={i}>
                <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={link ? "#F59E0B" : "#334155"} strokeWidth={link ? 2 : 1.2} strokeDasharray={link ? "5 4" : undefined} />
                {e.label && (
                  <text x={(s.x + t.x) / 2} y={(s.y + t.y) / 2 - 3} textAnchor="middle" fontSize="9" fill="#F59E0B" fontFamily="monospace">{e.label}</text>
                )}
              </g>
            );
          })}
          {nodes.map((n) => {
            const p = m.get(n.id);
            if (!p) return null;
            const r = n.type === "site" || n.type === "self" ? 14 : n.type === "rack" ? 11 : 8;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className="cursor-grab"
                onPointerDown={(e) => {
                  e.stopPropagation(); // não inicia pan
                  drag.current = n.id;
                  const pp = pos.current.get(n.id);
                  if (pp) pp.fixed = true;
                  svgRef.current?.setPointerCapture?.(e.pointerId);
                  alpha.current = Math.max(alpha.current, 0.5);
                }}
              >
                <circle r={r} fill={color(n)} stroke="#0A0E14" strokeWidth="2" />
                {p.fixed && lsKey && <circle r={r + 3} fill="none" stroke={color(n)} strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />}
                <text x={0} y={r + 12} textAnchor="middle" fontSize="10" fill="#E2E8F0">{n.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function ZoomBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="grid h-7 w-7 place-items-center rounded-md border border-border bg-surface/80 text-sm text-muted backdrop-blur hover:text-text cursor-pointer"
    >
      {children}
    </button>
  );
}
