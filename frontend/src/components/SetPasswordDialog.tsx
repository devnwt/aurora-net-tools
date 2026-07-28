/**
 * Popup INFECHÁVEL para o usuário convidado criar a primeira senha. Sem botão de
 * fechar nem clique no backdrop — a única saída sem definir a senha é sair (logout).
 * Aparece enquanto `must_set_password` for verdadeiro (ver Layout).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Input, Spinner } from "@/components/ui";
import { PASSWORD_HINT_KEY, passwordError } from "@/lib/password";
import { cn } from "@/lib/utils";

export function SetPasswordDialog() {
  const { t } = useTranslation();
  const { refresh, logout } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pwErr = passwordError(pw);
  const canSubmit = !pwErr && pw2 === pw;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api.post("/profile/set-password", { new_password: pw });
      await refresh(); // must_set_password vira false → o popup some
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="dlg-panel w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><KeyRound className="h-5 w-5" /></div>
          <div>
            <h2 className="text-base font-semibold">{t("profile:setPassword.title")}</h2>
            <p className="text-xs text-muted">{t("profile:setPassword.subtitle")}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted">{t("profile:setPassword.new")}</label>
            <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
              className={cn(pw && (pwErr ? "border-danger focus-visible:ring-danger" : "border-emerald-500 focus-visible:ring-emerald-500"))} />
            <p className={cn("text-[11px]", pw && pwErr ? "text-danger" : pw && !pwErr ? "text-emerald-500" : "text-muted")}>{t(PASSWORD_HINT_KEY)}</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">{t("profile:setPassword.confirm")}</label>
            <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              className={cn(pw2 && (pw2 === pw ? "border-emerald-500 focus-visible:ring-emerald-500" : "border-danger focus-visible:ring-danger"))} />
            {pw2 && pw2 !== pw && <p className="text-[11px] text-danger">{t("profile:setPassword.mismatch")}</p>}
          </div>
          {err && <p className="text-sm text-danger">{err}</p>}
          <Button type="submit" className="w-full justify-center" disabled={!canSubmit || busy}>
            {busy ? <Spinner className="border-primary-fg/40 border-t-primary-fg" /> : t("profile:setPassword.submit")}
          </Button>
          <button type="button" onClick={logout} className="w-full cursor-pointer text-center text-xs text-muted hover:text-text">
            {t("profile:setPassword.logout")}
          </button>
        </div>
      </form>
    </div>
  );
}
