// Cache em memória (vida da aba do navegador) para recursos TL1 *estruturais*
// que raramente mudam — info da OLT, placas, shelves e PONs. Evita refazer as
// consultas TL1 (lentas) ao alternar de aba ou reabrir uma OLT. O botão
// "Recarregar" de cada aba força o bypass (force=true). Recarregar a página
// (F5) limpa tudo, pois é apenas memória.
import { api } from "@/lib/api";

type Entry = { ts: number; data: unknown };
const store = new Map<string, Entry>();

/** Lê do cache se ainda válido, sem disparar requisição (para "primar" o estado). */
export function peekTl1<T>(url: string, ttlMs: number): T | null {
  const hit = store.get(url);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.data as T;
  return null;
}

/** GET com cache: devolve o valor válido em cache ou busca, guarda e devolve. */
export async function cachedTl1<T>(url: string, ttlMs: number, force = false): Promise<T> {
  if (!force) {
    const hit = peekTl1<T>(url, ttlMs);
    if (hit !== null) return hit;
  }
  const data = await api.get<T>(url);
  store.set(url, { ts: Date.now(), data });
  return data;
}

/** Invalida o cache: tudo, ou só as entradas cujo URL começa com `prefix`. */
export function invalidateTl1(prefix?: string): void {
  if (!prefix) return store.clear();
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
