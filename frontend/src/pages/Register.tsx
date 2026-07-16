import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, tokenStore } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";

export function Register() {
  const [f, setF] = useState({ org_name: "", username: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    api.get<{ enabled: boolean }>("/auth/registration-status").then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api.post<{ access_token: string }>("/auth/register", f);
      tokenStore.set(r.access_token);
      window.location.assign("/");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const valid = f.org_name && f.username && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) && f.password.length >= 6;

  return (
    <AuthShell subtitle="Criar conta">
      <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
        {enabled === false ? (
          <p className="text-sm text-danger">O cadastro público está desabilitado. Fale com o administrador. <Link to="/login" className="underline">Voltar ao login</Link>.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-xs text-white/60">Crie sua organização e o primeiro usuário administrador.</p>
            <div className="space-y-1">
              <label className="text-xs text-white/60">Organização</label>
              <Input value={f.org_name} onChange={(e) => setF({ ...f, org_name: e.target.value })} placeholder="Minha Empresa" autoFocus />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">Usuário</label>
              <Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">E-mail (login)</label>
              <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="voce@empresa.com" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">Senha (mín. 6)</label>
              <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            </div>
            {err && <p className="text-sm text-danger">{err}</p>}
            <Button type="submit" className="w-full justify-center" disabled={busy || !valid}>{busy ? "Criando…" : "Criar conta e entrar"}</Button>
            <Link to="/login" className="block text-center text-xs text-white/60 hover:text-white">Já tenho conta</Link>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
