// Gráfico de linha leve em SVG (sem dependências). Aceita 1+ séries {points,color}
// e desenha área + linha com rótulos de eixo. Responsivo (viewBox + width 100%).
import i18n from "@/i18n";

export interface Point {
  t: number; // epoch ms
  v: number;
}

export interface Series {
  points: Point[];
  color: string;
  label?: string;
}

const W = 800;
const H = 220;
const PAD = { l: 52, r: 12, t: 12, b: 22 };

function niceTime(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs <= 36 * 3600 * 1000) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function LineChart({
  series,
  unit = "",
  format,
  id = "lc",
  empty = i18n.t("common:chart.collecting"),
}: {
  series: Series[];
  unit?: string;
  format?: (v: number) => string;
  id?: string;
  empty?: string;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    return <div className="flex h-40 items-center justify-center text-xs text-muted">{empty}</div>;
  }

  const xs = all.map((p) => p.t);
  const ys = all.map((p) => p.v);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  let yMin = Math.min(...ys, 0);
  let yMax = Math.max(...ys);
  if (yMin === yMax) yMax = yMin + 1;
  else yMax += (yMax - yMin) * 0.15;

  const sx = (t: number) => PAD.l + ((t - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);
  const fmt = format ?? ((v: number) => `${v.toFixed(1)}${unit}`);

  const yTicks = [yMax, (yMax + yMin) / 2, yMin];
  const xTicks = [xMin, (xMin + xMax) / 2, xMax];
  const span = xMax - xMin;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none">

      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`${id}-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={s.color} stopOpacity="0.22" />
            <stop offset="1" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={sy(v)} x2={W - PAD.r} y2={sy(v)} stroke="#1F2937" strokeWidth="1" />
          <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" fontSize="10" fill="#94A3B8" fontFamily="monospace">{fmt(v)}</text>
        </g>
      ))}

      {xTicks.map((t, i) => (
        <text key={i} x={sx(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize="10" fill="#94A3B8" fontFamily="monospace">
          {niceTime(t, span)}
        </text>
      ))}

      {series.map((s, i) => {
        if (s.points.length < 2) return null;
        const line = s.points.map((p, j) => `${j === 0 ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
        const area = `${line} L${sx(s.points[s.points.length - 1].t).toFixed(1)},${H - PAD.b} L${sx(s.points[0].t).toFixed(1)},${H - PAD.b} Z`;
        return (
          <g key={i}>
            <path d={area} fill={`url(#${id}-fill-${i})`} />
            <path d={line} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
}
