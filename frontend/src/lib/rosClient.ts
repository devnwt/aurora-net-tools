// Serializa TODAS as chamadas RouterOS por device (GET e POST). O backend mantém
// um lock por device (uma sessão SSH por vez, 409 se concorrente); aqui:
//  (1) encadeamos as chamadas do mesmo device — nunca em paralelo;
//  (2) repetimos no 409 (caso o poller de background tenha pego o lock por instantes).
import { api, ApiError } from "@/lib/api";

const chains = new Map<number, Promise<unknown>>();

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && attempt < tries - 1) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw e;
    }
  }
}

function enqueue<T>(deviceId: number, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(deviceId) ?? Promise.resolve();
  const result = prev.then(() => retry(fn), () => retry(fn));
  chains.set(
    deviceId,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

export const rosGet = <T>(deviceId: number, path: string): Promise<T> =>
  enqueue(deviceId, () => api.get<T>(`/devices/${deviceId}/mikrotik${path}`));

export const rosPost = <T>(deviceId: number, path: string, body: unknown): Promise<T> =>
  enqueue(deviceId, () => api.post<T>(`/devices/${deviceId}/mikrotik${path}`, body));
