import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw.length < 6) return setErr("A senha deve ter ao menos 6 caracteres.");
    if (pw !== pw2) return setErr("As senhas não coincidem.");
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: pw });
      setDone(true);
      setTimeout(() => nav("/login"), 2500);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell subtitle="Redefinir senha">
      <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
        {!token ? (
          <p className="text-sm text-danger">Link inválido. Peça um novo em <Link to="/login" className="underline">Esqueci minha senha</Link>.</p>
        ) : done ? (
          <p className="text-sm text-ok">Senha redefinida! Redirecionando para o login…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="pw" className="text-xs text-white/60">Nova senha</label>
              <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1">
              <label htmlFor="pw2" className="text-xs text-white/60">Confirmar senha</label>
              <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            {err && <p className="text-sm text-danger">{err}</p>}
            <Button type="submit" className="w-full justify-center" disabled={busy}>{busy ? "Salvando…" : "Redefinir senha"}</Button>
            <Link to="/login" className="block text-center text-xs text-white/60 hover:text-white">Voltar ao login</Link>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
