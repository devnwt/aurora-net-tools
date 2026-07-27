import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api, ApiError, tokenStore } from "@/lib/api";
import type { PlanOption } from "@/lib/types";
import { isTrial } from "@/lib/plans";
import { Button, Input, Spinner } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { PlanShowcaseCard } from "@/components/PlanShowcaseCard";
import { PASSWORD_HINT_KEY, passwordError } from "@/lib/password";

interface PublicPlans {
  plans: PlanOption[];
  default_plan_id: number | null;
}
type Form = { org_name: string; username: string; email: string; password: string };

export function Register() {
  const { t } = useTranslation();
  const [f, setF] = useState<Form>({ org_name: "", username: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<"form" | "plan">("form");

  useEffect(() => {
    api.get<{ enabled: boolean }>("/auth/registration-status").then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false));
  }, []);

  const valid = f.org_name && f.username && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) && !passwordError(f.password);

  // Passo 1 só valida e avança — a conta é criada no passo 2, com o plano escolhido.
  function next(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setErr("");
    setStep("plan");
  }

  if (step === "plan") return <ChoosePlan form={f} onBack={() => setStep("form")} />;

  return (
    <AuthShell subtitle={t("auth:subtitle.register")}>
      <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
        {enabled === false ? (
          <p className="text-sm text-danger">{t("auth:register.disabled")} <Link to="/login" className="underline">{t("auth:register.backToLogin")}</Link>.</p>
        ) : (
          <form onSubmit={next} className="space-y-4">
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
            <Button type="submit" className="w-full justify-center" disabled={!valid}>
              {t("auth:register.submit")} <ArrowRight className="h-4 w-4" />
            </Button>
            <Link to="/login" className="block text-center text-xs text-white/60 hover:text-white">{t("auth:register.haveAccount")}</Link>
          </form>
        )}
      </div>
    </AuthShell>
  );
}

/** Passo 2: escolha OBRIGATÓRIA de plano (Trial pré-selecionado) → cria a conta → login. */
function ChoosePlan({ form, onBack }: { form: Form; onBack: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<PublicPlans | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<PublicPlans>("/auth/plans")
      .then((d) => {
        setData(d);
        // Default: o plano de teste; senão o default do Master; senão o primeiro.
        const trial = d.plans.find((p) => isTrial(p.name));
        setSelected(trial?.id ?? d.default_plan_id ?? d.plans[0]?.id ?? null);
      })
      .catch(() => setData({ plans: [], default_plan_id: null }));
  }, []);

  const plans = data?.plans ?? [];
  const reserveRibbon = plans.some((p) => isTrial(p.name));
  const topId = plans.filter((p) => !isTrial(p.name)).reduce<PlanOption | null>((m, p) => (!m || p.max_devices > m.max_devices ? p : m), null)?.id;
  const selectedPlan = plans.find((p) => p.id === selected) ?? null;
  const selectedIsTrial = selectedPlan != null && isTrial(selectedPlan.name);

  // Cria a conta (só ao confirmar aqui) e JÁ LOGA o usuário (guarda o token).
  async function create() {
    if (selected == null) return; // escolha obrigatória
    setBusy(true);
    setErr("");
    try {
      const r = await api.post<{ access_token: string }>("/auth/register", { ...form, plan_id: selected });
      tokenStore.set(r.access_token);
      window.location.assign("/"); // recarrega já autenticado
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <AuthShell subtitle={t("auth:register.choose.shellSubtitle")} wide>
      <div className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md sm:p-8">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-semibold text-white">{t("auth:register.choose.title")}</h2>
          <p className="mt-1 text-sm text-white/60">{t("auth:register.choose.subtitle")}</p>
        </div>

        {data === null ? (
          <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
        ) : (
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
                onSelect={() => setSelected(p.id)}
              />
            ))}
          </div>
        )}

        {selectedIsTrial && <p className="mt-4 text-center text-xs text-accent">{t("auth:register.choose.trialNote")}</p>}
        {err && <p className="mt-4 text-center text-sm text-danger">{err}</p>}

        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="ghost" onClick={onBack} disabled={busy}><ArrowLeft className="h-4 w-4" /> {t("auth:register.choose.back")}</Button>
          <Button onClick={create} disabled={busy || selected == null} className="px-6">
            {busy
              ? t("auth:register.choose.creating")
              : <>{selectedIsTrial
                  ? t("auth:register.choose.proceedFree")
                  : t("auth:register.choose.proceed", { name: selectedPlan?.name ?? "" })} <ArrowRight className="h-4 w-4" /></>}
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
