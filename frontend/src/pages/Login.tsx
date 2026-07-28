import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ApiError, api, tokenStore, type LoginResult } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { PlanOption } from "@/lib/types";
import { isTrial } from "@/lib/plans";
import { Button, Input, Spinner } from "@/components/ui";
import { FloatingInput } from "@/components/FloatingInput";
import { AuthShell } from "@/components/AuthShell";
import { PlanShowcaseCard } from "@/components/PlanShowcaseCard";

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
  const [reactivate, setReactivate] = useState<LoginResult | null>(null);

  useEffect(() => {
    api.get<{ enabled: boolean }>("/auth/registration-status").then((r) => setRegEnabled(r.enabled)).catch(() => {});
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
        // Muitas tentativas (rate limit/lockout): mensagem amigável com o tempo
        // de espera, quando informado. Não revela se o bloqueio é por IP ou conta.
        const secs = err.retryAfter ?? 0;
        const msg = secs >= 60
          ? t("auth:login.rateLimitedMin", { minutes: Math.ceil(secs / 60) })
          : secs > 0
            ? t("auth:login.rateLimitedSec", { seconds: secs })
            : t("auth:login.rateLimited");
        toast.error(msg, { title: t("auth:login.rateLimitedTitle") });
      } else {
        // Backend inalcançável faz o fetch rejeitar com TypeError, não ApiError.
        // Sem separar os dois, uma queda do servidor aparecia como senha errada.
        toast.error(err instanceof ApiError ? err : t("common:state.serverUnreachable"), {
          title: t("auth:login.failTitle"),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  if (reactivate) return <WelcomeBack data={reactivate} onBack={() => setReactivate(null)} />;

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
        <form onSubmit={onForgot} className="mt-4 space-y-4 rounded-2xl border border-primary/30 bg-black/30 p-6 shadow-lg shadow-primary/10 ring-1 ring-primary/10 backdrop-blur-md">
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
      const r = await api.post<{ access_token: string }>("/auth/reactivate", { reactivate_token: data.reactivate_token, plan_id: selected });
      tokenStore.set(r.access_token);
      window.location.assign("/"); // recarrega já autenticado
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
