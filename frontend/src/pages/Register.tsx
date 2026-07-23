import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError, tokenStore } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { PASSWORD_HINT_KEY, passwordError } from "@/lib/password";

export function Register() {
  const { t } = useTranslation();
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

  const valid = f.org_name && f.username && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) && !passwordError(f.password);

  return (
    <AuthShell subtitle={t("auth:subtitle.register")}>
      <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
        {enabled === false ? (
          <p className="text-sm text-danger">{t("auth:register.disabled")} <Link to="/login" className="underline">{t("auth:register.backToLogin")}</Link>.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-xs text-white/60">{t("auth:register.intro")}</p>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.org")}</label>
              <Input value={f.org_name} onChange={(e) => setF({ ...f, org_name: e.target.value })} placeholder={t("auth:register.orgPlaceholder")} autoFocus />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.user")}</label>
              <Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.email")}</label>
              <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={t("auth:register.emailPlaceholder")} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.password")}</label>
              <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
              <p className={`text-[11px] ${f.password && passwordError(f.password) ? "text-danger" : "text-white/40"}`}>{t(PASSWORD_HINT_KEY)}</p>
            </div>
            {err && <p className="text-sm text-danger">{err}</p>}
            <Button type="submit" className="w-full justify-center" disabled={busy || !valid}>{busy ? t("auth:register.submitting") : t("auth:register.submit")}</Button>
            <Link to="/login" className="block text-center text-xs text-white/60 hover:text-white">{t("auth:register.haveAccount")}</Link>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
