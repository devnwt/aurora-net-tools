const BASE = import.meta.env.VITE_API_BASE ?? "/api";

const TOKEN_KEY = "aurora_token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    tokenStore.clear();
    if (!path.startsWith("/auth/login")) window.location.assign("/login");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data?.detail ?? res.statusText;
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(p: string, body: unknown) =>
    request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(p: string, body: unknown) =>
    request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  del: (p: string) => request<void>(p, { method: "DELETE" }),
  /** POST que retorna a Response crua para leitura em streaming (SSE). */
  postStream: (p: string, body: unknown) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    const token = tokenStore.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${BASE}${p}`, { method: "POST", headers, body: JSON.stringify(body) });
  },
  async login(username: string, password: string) {
    const form = new URLSearchParams({ username, password });
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) {
      // Só 401 é credencial errada. Tratar 500/502/503 como "credenciais
      // inválidas" manda procurar o problema no lugar errado — foi assim que
      // um backend fora do ar já passou por senha errada.
      throw new ApiError(
        res.status,
        res.status === 401 ? "Usuário ou senha incorretos." : `O servidor respondeu ${res.status}.`,
      );
    }
    const data = (await res.json()) as { access_token: string };
    tokenStore.set(data.access_token);
    return data;
  },
};
