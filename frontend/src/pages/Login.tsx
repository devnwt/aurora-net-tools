import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { Button, Input } from "@/components/ui";
import { FloatingInput } from "@/components/FloatingInput";
import { AuthShell } from "@/components/AuthShell";

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [forgot, setForgot] = useState(false);
  const [ident, setIdent] = useState("");
  const [note, setNote] = useState("");
  const [regEnabled, setRegEnabled] = useState(false);

  useEffect(() => {
    api.get<{ enabled: boolean }>("/auth/registration-status").then((r) => setRegEnabled(r.enabled)).catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username, password);
      nav("/");
    } catch (err) {
      // Backend inalcançável faz o fetch rejeitar com TypeError, não ApiError.
      // Sem separar os dois, uma queda do servidor aparecia como senha errada.
      toast.error(err instanceof ApiError ? err : t("common:state.serverUnreachable"), {
        title: t("auth:login.failTitle"),
      });
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
      setNote(t("auth:forgot.fallbackNote"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell subtitle={forgot ? t("auth:subtitle.forgot") : t("auth:subtitle.login")}>
      {forgot ? (
        <form onSubmit={onForgot} className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
          <p className="text-xs text-white/60">{t("auth:forgot.hint")}</p>
          <div className="space-y-1">
            <label htmlFor="id" className="text-xs text-white/60">{t("auth:forgot.identLabel")}</label>
            <Input id="id" value={ident} onChange={(e) => setIdent(e.target.value)} autoFocus />
          </div>
          {note && <p className="text-sm text-ok">{note}</p>}
          <Button type="submit" className="w-full justify-center" disabled={busy || !ident}>{busy ? t("auth:forgot.submitting") : t("auth:forgot.submit")}</Button>
          <button type="button" onClick={() => { setForgot(false); setNote(""); }} className="w-full text-center text-xs text-white/60 hover:text-white cursor-pointer">{t("auth:forgot.back")}</button>
        </form>
      ) : (
        <form onSubmit={onSubmit} className="flex aspect-square w-full max-w-sm flex-col justify-center space-y-5 rounded-2xl border border-white/10 bg-black/30 p-8 backdrop-blur-md">
          <FloatingInput id="u" label={t("auth:login.identifier")} type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          <FloatingInput id="p" label={t("auth:login.password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" className="w-full justify-center py-2.5" disabled={busy}>{busy ? t("auth:login.submitting") : t("auth:login.submit")}</Button>
          <div className="flex items-center justify-between text-xs">
            <button type="button" onClick={() => setForgot(true)} className="text-white/60 hover:text-white cursor-pointer">{t("auth:login.forgotLink")}</button>
            {regEnabled && <Link to="/register" className="text-primary hover:underline">{t("auth:login.registerLink")}</Link>}
          </div>
        </form>
      )}
    </AuthShell>
  );
}
