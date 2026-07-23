import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { PASSWORD_HINT_KEY, passwordError } from "@/lib/password";

export function ResetPassword() {
  const { t } = useTranslation();
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
    const pe = passwordError(pw);
    if (pe) return setErr(t(pe));
    if (pw !== pw2) return setErr(t("auth:reset.mismatch"));
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
    <AuthShell subtitle={t("auth:subtitle.reset")}>
      <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
        {!token ? (
          <p className="text-sm text-danger">{t("auth:reset.invalidPrefix")} <Link to="/login" className="underline">{t("auth:reset.forgotLink")}</Link>.</p>
        ) : done ? (
          <p className="text-sm text-ok">{t("auth:reset.done")}</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="pw" className="text-xs text-white/60">{t("auth:reset.newPassword")}</label>
              <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
              <p className={`text-[11px] ${pw && passwordError(pw) ? "text-danger" : "text-white/40"}`}>{t(PASSWORD_HINT_KEY)}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="pw2" className="text-xs text-white/60">{t("auth:reset.confirmPassword")}</label>
              <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            {err && <p className="text-sm text-danger">{err}</p>}
            <Button type="submit" className="w-full justify-center" disabled={busy}>{busy ? t("auth:reset.submitting") : t("auth:reset.submit")}</Button>
            <Link to="/login" className="block text-center text-xs text-white/60 hover:text-white">{t("auth:reset.back")}</Link>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
