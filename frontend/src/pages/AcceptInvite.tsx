/**
 * Destino do link de convite (e-mail): troca o token do convite por uma sessão e
 * entra no sistema. Lá dentro, o popup infechável (SetPasswordDialog) força criar
 * a senha. Sem token/expirado → mostra erro com link para o login.
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import { Spinner } from "@/components/ui";

export function AcceptInvite() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [err, setErr] = useState("");

  useEffect(() => {
    const token = params.get("token");
    if (!token) { setErr(t("auth:invite.missing")); return; }
    api.post("/auth/accept-invite", { token })
      .then(() => { window.location.assign("/"); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [params, t]);

  return (
    <AuthShell subtitle={t("auth:invite.shellSubtitle")}>
      <div className="auth-step-in rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
        {err ? (
          <p className="text-sm text-danger">
            {err} <Link to="/login" className="underline">{t("auth:invite.backToLogin")}</Link>.
          </p>
        ) : (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/70">
            <Spinner className="h-5 w-5" /> {t("auth:invite.entering")}
          </div>
        )}
      </div>
    </AuthShell>
  );
}
