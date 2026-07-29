import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore, type LoginResult } from "./api";

interface Me {
  id: number;
  email: string | null;
  name?: string | null;
  phone?: string | null;
  document?: string | null;
  photo?: string | null;
  is_admin: boolean;
  role: string;
  org_id: number | null;
  plan?: string | null;
  /** Plano (trial) vencido → popup de planos infechável no login. */
  plan_expired?: boolean;
  plan_expires_at?: string | null;
  /** Convidado que ainda não definiu senha → popup infechável. */
  must_set_password?: boolean;
}

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<LoginResult>;
  logout: () => void;
  /** Recarrega /auth/me (ex.: após definir a senha inicial ou atualizar o perfil). */
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api
      .get<Me>("/auth/me")
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  async function login(u: string, p: string) {
    const res = await api.login(u, p);
    // Só carrega o usuário quando veio token; reativação é tratada pelo chamador.
    if (res.access_token) setUser(await api.get<Me>("/auth/me"));
    return res;
  }

  function logout() {
    tokenStore.clear();
    setUser(null);
    window.location.assign("/login");
  }

  async function refresh() {
    if (!tokenStore.get()) return;
    try {
      setUser(await api.get<Me>("/auth/me"));
    } catch {
      /* mantém o estado atual se falhar */
    }
  }

  return <Ctx.Provider value={{ user, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
