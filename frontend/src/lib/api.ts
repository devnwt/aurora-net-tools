const BASE = import.meta.env.VITE_API_BASE ?? "/api";

/** Header CSRF: pedidos com cookie HttpOnly sem Bearer exigem este valor. */
const CLIENT_HEADER = "X-Aurora-Client";
const CLIENT_WEB = "web";

/** Remove restos pré-AUTH-003 (tokens em localStorage). */
function clearLegacyTokens() {
  localStorage.removeItem("aurora_token");
  localStorage.removeItem("aurora_refresh");
}

clearLegacyTokens();

/** Resposta de /auth/login: sessão via cookie (web) OU tokens no body (API). */
export interface LoginResult {
  ok?: boolean;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  reactivate?: boolean;
  reactivate_token?: string;
  username?: string;
  plans?: { id: number; name: string; max_devices: number; max_users: number }[];
  trial_available?: boolean;
}

export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  attemptsLeft?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function webHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(CLIENT_HEADER, CLIENT_WEB);
  return headers;
}

/** Uma renovação por vez — evita tempestade de /auth/refresh em 401 paralelo. */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: webHeaders({ "Content-Type": "application/json" }),
      body: "{}",
    });
    return res.ok;
  } catch {
    return false;
  }
}

function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = tryRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const headers = webHeaders(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers, credentials: "include" });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    if (!retried && (await refreshOnce())) {
      return request<T>(path, options, true);
    }
    clearLegacyTokens();
    window.location.assign("/login");
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
  postStream: (p: string, body: unknown) => {
    const headers = webHeaders({ "Content-Type": "application/json" });
    return fetch(`${BASE}${p}`, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(body),
    });
  },
  async login(username: string, password: string) {
    const form = new URLSearchParams({ username, password });
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: webHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: form,
    });
    if (!res.ok) {
      if (res.status === 429) {
        const ra = parseInt(res.headers.get("Retry-After") ?? "", 10);
        throw new ApiError(429, "rate_limited", Number.isFinite(ra) ? ra : undefined);
      }
      if (res.status === 401) {
        const left = parseInt(res.headers.get("X-Login-Attempts-Left") ?? "", 10);
        const e = new ApiError(401, "invalid_credentials");
        if (Number.isFinite(left)) e.attemptsLeft = left;
        throw e;
      }
      throw new ApiError(res.status, "login_error");
    }
    return (await res.json()) as LoginResult;
  },
  async logout() {
    try {
      await fetch(`${BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: webHeaders({ "Content-Type": "application/json" }),
        body: "{}",
      });
    } catch {
      /* limpa sessão local mesmo se a API falhar */
    }
    clearLegacyTokens();
  },
  async logoutAll() {
    try {
      await request("/auth/logout-all", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    clearLegacyTokens();
  },
};

/** @deprecated tokens não ficam mais no JS — mantido só p/ limpeza/migração. */
export const tokenStore = {
  get: () => null as string | null,
  clear: clearLegacyTokens,
};
