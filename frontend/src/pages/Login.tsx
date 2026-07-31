import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, ShieldAlert } from "lucide-react";
import { ApiError, api, type LoginResult } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { PlanOption } from "@/lib/types";
import { isTrial } from "@/lib/plans";
import { Button, Input, Spinner } from "@/components/ui";
import { FloatingInput } from "@/components/FloatingInput";
import { AuthShell } from "@/components/AuthShell";
import { PlanShowcaseCard } from "@/components/PlanShowcaseCard";
import { WhatsAppSupport } from "@/components/WhatsAppSupport";

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
  // Esqueci a senha: se o e-mail saiu (null = ainda não pediu) e cooldown p/ reenviar.
  const [forgotSent, setForgotSent] = useState<boolean | null>(null);
  const [forgotCd, setForgotCd] = useState(0);
  const [regEnabled, setRegEnabled] = useState(false);
  const [reactivate, setReactivate] = useState<LoginResult | null>(null);
  const [supportUrl, setSupportUrl] = useState("");
  // Conta/IP bloqueado (429): segundos até liberar (0 = sem tempo informado). null = fechado.
  const [locked, setLocked] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<{ enabled: boolean; support_whatsapp_url?: string }>("/auth/registration-status")
      .then((r) => { setRegEnabled(r.enabled); setSupportUrl(r.support_whatsapp_url || ""); })
      .catch(() => {});
  }, []);

  // Cooldown do reenvio do "esqueci a senha" (conta regressiva óbvia).
  useEffect(() => {
    const id = window.setInterval(() => setForgotCd((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Vindo da exclusão da empresa (Danger Zone): confirma o sucesso após o redirect.
  useEffect(() => {
    if (sessionStorage.getItem("aurora_account_deleted")) {
      sessionStorage.removeItem("aurora_account_deleted");
      toast.success(t("auth:accountDeleted.body"), { title: t("auth:accountDeleted.title"), duration: 0 });
    }
  }, [t, toast]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await login(username, password);
      // Admin de empresa inativo: em vez de erro, entra no fluxo "bem-vindo de volta".
      if (res.reactivate) {
        setReactivate(res);
        return;
      }
      nav("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // Bloqueado (rate limit/lockout): abre um popup explicando + opção de suporte.
        // Não revela se o bloqueio é por IP ou conta.
        setLocked(err.retryAfter ?? 0);
      } else if (err instanceof ApiError && err.status === 401) {
        // Credencial inválida. Perto do bloqueio (poucas tentativas), avisa em tom
        // de alerta com a contagem; caso contrário, mensagem simples.
        const left = err.attemptsLeft;
        if (left !== undefined && left > 0 && left <= 2) {
          const msg = left === 1 ? t("auth:login.wrongLastAttempt") : t("auth:login.wrongNearLock", { count: left });
          toast.warning(msg, { title: t("auth:login.warnTitle") });
        } else {
          toast.error(t("auth:login.wrongCredentials"), { title: t("auth:login.failTitle") });
        }
      } else if (err instanceof ApiError && err.status === 403) {
        // Conta desativada/indisponível — mensagem humanizada, orienta contatar o admin.
        toast.error(t("auth:login.accountUnavailable"), { title: t("auth:login.failTitle") });
      } else if (err instanceof ApiError) {
        // Qualquer outro problema do servidor (5xx etc.) — sem código técnico.
        toast.error(t("auth:login.generic"), { title: t("auth:login.failTitle") });
      } else {
        // fetch rejeitou (backend inalcançável) — problema de conexão.
        toast.error(t("auth:login.unreachable"), { title: t("auth:login.failTitle") });
      }
    } finally {
      setBusy(false);
    }
  }

  if (reactivate) return <WelcomeBack data={reactivate} onBack={() => setReactivate(null)} />;

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    if (forgotCd > 0) return; // respeita o cooldown do reenvio
    setBusy(true);
    setNote("");
    try {
      const r = await api.post<{ detail: string; email_sent?: boolean; cooldown?: number }>("/auth/forgot-password", { identifier: ident });
      setNote(r.detail);
      setForgotSent(r.email_sent ?? true);
      setForgotCd(r.cooldown ?? 60);
    } catch (err) {
      setNote(t("auth:forgot.fallbackNote"));
      if (err instanceof ApiError && err.status === 429) setForgotCd(err.retryAfter ?? 60);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {locked !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#11161F] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-danger/15 text-danger">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-white">{t("auth:login.rateLimitedTitle")}</h2>
            <p className="mt-2 text-sm text-white/60">
              {locked >= 60
                ? t("auth:login.rateLimitedMin", { minutes: Math.ceil(locked / 60) })
                : locked > 0
                  ? t("auth:login.rateLimitedSec", { seconds: locked })
                  : t("auth:login.rateLimited")}
            </p>
            <p className="mt-2 text-xs text-white/40">{t("auth:login.lockedHelp")}</p>
            <div className="mt-6 flex items-center justify-center gap-2">
              <WhatsAppSupport url={supportUrl} label={t("plans:supportWhatsapp")} />
              <button
                onClick={() => setLocked(null)}
                className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white cursor-pointer"
              >
                {t("auth:login.lockedUnderstood")}
              </button>
            </div>
          </div>
        </div>
      )}
      <AuthShell subtitle={forgot ? t("auth:subtitle.forgot") : t("auth:subtitle.login")}>
      {forgot ? (
        <form onSubmit={onForgot} className="mt-4 space-y-4 rounded-2xl border border-primary/30 bg-black/30 p-6 shadow-lg shadow-primary/10 ring-1 ring-primary/10 backdrop-blur-md">
          <p className="text-xs text-white/60">{t("auth:forgot.hint")}</p>
          <div className="space-y-1">
            <label htmlFor="id" className="text-xs text-white/60">{t("auth:forgot.identLabel")}</label>
            <Input id="id" value={ident} onChange={(e) => setIdent(e.target.value)} autoFocus />
          </div>
          {note && <p className="text-sm text-ok">{note}</p>}
          {forgotSent === false && <p className="text-xs text-amber-300">{t("auth:forgot.emailFailed")}</p>}
          <Button type="submit" className="w-full justify-center" disabled={busy || !ident || forgotCd > 0}>
            {busy
              ? t("auth:forgot.submitting")
              : forgotCd > 0
                ? t("auth:forgot.resendIn", { seconds: forgotCd })
                : forgotSent !== null
                  ? t("auth:forgot.resend")
                  : t("auth:forgot.submit")}
          </Button>
          <button type="button" onClick={() => { setForgot(false); setNote(""); setForgotSent(null); setForgotCd(0); }} className="w-full text-center text-xs text-white/60 hover:text-white cursor-pointer">{t("auth:forgot.back")}</button>
        </form>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 flex aspect-square w-full max-w-sm flex-col justify-center space-y-5 rounded-2xl border-t-4 border-t-blue-500 bg-black/30 p-8 shadow-lg shadow-primary/10 backdrop-blur-md">
          <FloatingInput id="u" label={t("auth:login.identifier")} type="email" autoComplete="email" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          <FloatingInput id="p" label={t("auth:login.password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" className="w-full justify-center py-2.5" disabled={busy}>
            {busy ? <Spinner className="border-primary-fg/40 border-t-primary-fg" /> : t("auth:login.submit")}
          </Button>
          <div className="flex items-center justify-between text-xs">
            <button type="button" onClick={() => setForgot(true)} className="text-white/60 hover:text-white cursor-pointer">{t("auth:login.forgotLink")}</button>
            {regEnabled && <Link to="/register" className="text-primary hover:underline">{t("auth:login.registerLink")}</Link>}
          </div>
        </form>
      )}
      </AuthShell>
    </>
  );
}

/** "Bem-vindo de volta": admin de empresa inativo escolhe um plano e reativa a conta. */
function WelcomeBack({ data, onBack }: { data: LoginResult; onBack: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const plans = data.plans ?? [];
  const trialAvailable = data.trial_available !== false; // trial vencido → não pode reescolher
  const reserveRibbon = plans.some((p) => isTrial(p.name));
  const topId = plans.filter((p) => !isTrial(p.name)).reduce<PlanOption | null>((m, p) => (!m || p.max_devices > m.max_devices ? p : m), null)?.id;
  const trial = plans.find((p) => isTrial(p.name));
  // Pré-seleção: trial se ainda elegível; senão o primeiro plano pago disponível.
  const firstPaid = plans.find((p) => !isTrial(p.name))?.id ?? null;
  const [selected, setSelected] = useState<number | null>(
    trialAvailable ? (trial?.id ?? plans[0]?.id ?? null) : firstPaid,
  );
  const [busy, setBusy] = useState(false);

  async function reactivate() {
    if (selected == null) return;
    setBusy(true);
    try {
      await api.post("/auth/reactivate", { reactivate_token: data.reactivate_token, plan_id: selected });
      window.location.assign("/");
    } catch (e) {
      toast.error(e instanceof ApiError ? e : t("auth:reactivate.failed"), { title: t("auth:reactivate.failed") });
      setBusy(false);
    }
  }

  return (
    <AuthShell subtitle={t("auth:reactivate.shellSubtitle")} wide>
      <div className="auth-step-in rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md sm:p-8">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-semibold text-white">{t("auth:reactivate.title", { name: data.username ?? "" })}</h2>
          <p className="mt-1 text-sm text-white/60">{t("auth:reactivate.subtitle")}</p>
        </div>

        <div className="grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p, i) => (
            <PlanShowcaseCard
              key={p.id}
              plan={p}
              index={i}
              recommended={p.id === topId}
              yourPlan={false}
              reserveRibbon={reserveRibbon}
              maxFeatures={5}
              selected={selected === p.id}
              locked={isTrial(p.name) && !trialAvailable}
              onSelect={() => setSelected(p.id)}
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="ghost" onClick={onBack} disabled={busy}><ArrowLeft className="h-4 w-4" /> {t("auth:reactivate.back")}</Button>
          <Button onClick={reactivate} disabled={busy || selected == null} className="px-6">
            {busy ? t("auth:reactivate.submitting") : <>{t("auth:reactivate.submit")} <ArrowRight className="h-4 w-4" /></>}
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
