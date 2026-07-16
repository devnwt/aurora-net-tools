// Ilustração vetorial de um device MikroTik, escolhida pela família do modelo.
// Não depende de assets externos (gerada localmente) e varia conforme o board
// e o nº de portas detectado nas interfaces.

type Family = "rack" | "switch" | "desktop";

function familyOf(model: string): Family {
  const m = (model || "").toUpperCase();
  if (m.startsWith("CCR")) return "rack";
  if (m.startsWith("CRS") || m.startsWith("RB260") || m.includes("SWITCH")) return "switch";
  return "desktop"; // RB, hEX, hAP, wAP, cAP, L009, etc.
}

const C = {
  body: "#11161F",
  body2: "#171E2A",
  edge: "#1F2937",
  muted: "#94A3B8",
  led: "#22C55E",
  accent: "#F59E0B",
  primary: "#3B82F6",
  text: "#E2E8F0",
};

function Ports({ count, x, y, cols }: { count: number; x: number; y: number; cols: number }) {
  const w = 20;
  const h = 14;
  const gap = 6;
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return (
          <rect
            key={i}
            x={x + col * (w + gap)}
            y={y + row * (h + gap)}
            width={w}
            height={h}
            rx={2}
            fill={i === 0 ? C.led : C.body}
            stroke={C.edge}
          />
        );
      })}
    </g>
  );
}

export function DeviceIllustration({
  model,
  ports = 5,
  className,
}: {
  model: string;
  ports?: number;
  className?: string;
}) {
  const family = familyOf(model);
  const portCount = Math.min(Math.max(ports, 1), family === "desktop" ? 10 : 24);

  return (
    <svg viewBox="0 0 320 150" className={className} role="img" aria-label={`MikroTik ${model || "device"}`}>
      <defs>
        <linearGradient id="mtk-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.body2} />
          <stop offset="1" stopColor={C.body} />
        </linearGradient>
      </defs>

      {family === "desktop" && (
        <>
          {/* antenas */}
          <rect x="60" y="6" width="4" height="34" rx="2" fill={C.muted} />
          <rect x="256" y="6" width="4" height="34" rx="2" fill={C.muted} />
          <rect x="40" y="40" width="240" height="92" rx="12" fill="url(#mtk-body)" stroke={C.edge} strokeWidth="2" />
          <rect x="40" y="40" width="240" height="10" rx="6" fill={C.accent} opacity="0.85" />
          <circle cx="258" cy="64" r="4" fill={C.led} />
          <Ports count={portCount} x={60} y={86} cols={5} />
        </>
      )}

      {family === "switch" && (
        <>
          <rect x="16" y="44" width="288" height="78" rx="8" fill="url(#mtk-body)" stroke={C.edge} strokeWidth="2" />
          <rect x="16" y="44" width="6" height="78" rx="3" fill={C.primary} />
          <circle cx="290" cy="58" r="4" fill={C.led} />
          <Ports count={portCount} x={36} y={62} cols={12} />
        </>
      )}

      {family === "rack" && (
        <>
          {/* orelhas de rack */}
          <rect x="8" y="50" width="14" height="60" rx="3" fill={C.body2} stroke={C.edge} />
          <rect x="298" y="50" width="14" height="60" rx="3" fill={C.body2} stroke={C.edge} />
          <rect x="22" y="52" width="276" height="56" rx="6" fill="url(#mtk-body)" stroke={C.edge} strokeWidth="2" />
          {/* vents */}
          <g stroke={C.edge}>
            {Array.from({ length: 6 }).map((_, i) => (
              <line key={i} x1={232 + i * 8} y1={60} x2={232 + i * 8} y2={100} />
            ))}
          </g>
          <circle cx="40" cy="62" r="4" fill={C.led} />
          <Ports count={portCount} x={40} y={74} cols={12} />
        </>
      )}

      <text x="160" y="145" textAnchor="middle" fill={C.muted} fontSize="11" fontFamily="monospace">
        {model || "RouterOS"}
      </text>
    </svg>
  );
}
