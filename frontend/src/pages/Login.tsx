import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Input } from "@/components/ui";
import { FloatingInput } from "@/components/FloatingInput";
import { AuthShell } from "@/components/AuthShell";

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [forgot, setForgot] = useState(false);
  const [ident, setIdent] = useState("");
  const [note, setNote] = useState("");
  const [regEnabled, setRegEnabled] = useState(false);

  useEffect(() => {
    api.get<{ enabled: boolean }>("/auth/registration-status").then((r) => setRegEnabled(r.enabled)).catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username, password);
      nav("/");
    } catch {
      setError("Credenciais inválidas.");
    } finally {
      setBusy(false);
    }
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote("");
    try {
      const r = await api.post<{ detail: string }>("/auth/forgot-password", { identifier: ident });
      setNote(r.detail);
    } catch {
      setNote("Se houver uma conta com e-mail cadastrado, enviamos um link de redefinição.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell subtitle={forgot ? "Recuperar senha" : "Entre para continuar"}>
      {forgot ? (
        <form onSubmit={onForgot} className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
          <p className="text-xs text-white/60">Informe seu usuário ou e-mail. Enviaremos um link para redefinir a senha.</p>
          <div className="space-y-1">
            <label htmlFor="id" className="text-xs text-white/60">Usuário ou e-mail</label>
            <Input id="id" value={ident} onChange={(e) => setIdent(e.target.value)} autoFocus />
          </div>
          {note && <p className="text-sm text-ok">{note}</p>}
          <Button type="submit" className="w-full justify-center" disabled={busy || !ident}>{busy ? "Enviando…" : "Enviar link"}</Button>
          <button type="button" onClick={() => { setForgot(false); setNote(""); }} className="w-full text-center text-xs text-white/60 hover:text-white cursor-pointer">Voltar ao login</button>
        </form>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-8 backdrop-blur-md sm:p-10">
          <FloatingInput id="u" label="Email ou usuário" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          <FloatingInput id="p" label="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full justify-center py-2.5" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
          <div className="flex items-center justify-between text-xs">
            <button type="button" onClick={() => setForgot(true)} className="text-white/60 hover:text-white cursor-pointer">Esqueci minha senha</button>
            {regEnabled && <Link to="/register" className="text-primary hover:underline">Criar conta</Link>}
          </div>
        </form>
      )}
    </AuthShell>
  );
}
