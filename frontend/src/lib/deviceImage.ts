// Mapeia o `board` do RouterOS (ex.: "L009UiGS-2HaxD", "CCR1009-7G-1C-1S+")
// para o PNG oficial em src/mikrotik_png. Os nomes de arquivo costumam ter
// convenções mistas: maiúsculas/underscore, nome duplicado, sufixos -IN/_rm e o
// "+" ora escrito "plus" ("2Splus"), ora omitido ("8s"). Por isso normalizamos
// cada lado em DUAS variantes (+→plus e +→"") e casamos qualquer-uma-contra-
// qualquer, por igualdade → prefixo (o prefixo comum mais longo vence).

const modules = import.meta.glob("../mikrotik_png/*.png", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Reduz nomes duplicados (ex.: "12POW15012pow150" → "12pow150").
function reduceDoubled(k: string): string {
  if (k.length % 2 === 0) {
    const h = k.length / 2;
    if (k.slice(0, h) === k.slice(h)) return k.slice(0, h);
  }
  return k;
}

/** Duas normalizações: "+"→"plus" e "+" removido (dedupe). */
function variants(s: string): string[] {
  const base = (s || "").toLowerCase();
  const plus = reduceDoubled(base.replace(/\+/g, "plus").replace(/[^a-z0-9]/g, ""));
  const strip = reduceDoubled(base.replace(/[^a-z0-9]/g, ""));
  return plus === strip ? [plus] : [plus, strip];
}

interface Entry {
  keys: string[];
  url: string;
}

const entries: Entry[] = Object.entries(modules).map(([p, url]) => {
  const base = (p.split("/").pop() ?? "").replace(/\.png$/i, "");
  return { keys: variants(base), url };
});

/** URL do PNG do device para um dado board, ou null se não houver correspondência. */
export function deviceImageUrl(board: string | null | undefined): string | null {
  const bKeys = variants(board ?? "").filter((k) => k.length >= 3);
  if (bKeys.length === 0) return null;

  // 1) igualdade exata em qualquer variante.
  for (const e of entries) {
    if (e.keys.some((k) => bKeys.includes(k))) return e.url;
  }
  // 2) prefixo (qualquer direção); o mais longo vence.
  let best: { url: string; len: number } | null = null;
  for (const e of entries) {
    for (const ek of e.keys) {
      if (ek.length < 5) continue;
      for (const bk of bKeys) {
        if (bk.length < 5) continue;
        if (!ek.startsWith(bk) && !bk.startsWith(ek)) continue;
        const len = Math.min(ek.length, bk.length);
        if (!best || len > best.len) best = { url: e.url, len };
      }
    }
  }
  return best?.url ?? null;
}
