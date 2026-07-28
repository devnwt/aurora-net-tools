import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { api, ApiError, tokenStore } from "@/lib/api";
import type { PlanOption } from "@/lib/types";
import { isTrial } from "@/lib/plans";
import { Button, Input, Spinner } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { PlanShowcaseCard } from "@/components/PlanShowcaseCard";
import { PASSWORD_HINT_KEY, passwordError } from "@/lib/password";
import { cn } from "@/lib/utils";

interface PublicPlans {
  plans: PlanOption[];
  default_plan_id: number | null;
}
type Form = { org_name: string; email: string; password: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
type FieldState = "" | "ok" | "err";

/** Input com validação visual: borda verde quando OK, vermelha quando inválido,
 * neutra quando vazio — com ícone à direita. */
function ValidatedInput({ state, className, ...props }: { state: FieldState } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Input
        {...props}
        className={cn(
          "transition-colors",
          state === "ok" && "border-emerald-500 pr-9 focus-visible:ring-emerald-500",
          state === "err" && "border-danger pr-9 focus-visible:ring-danger",
          className,
        )}
      />
      {state === "ok" && <Check className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" />}
      {state === "err" && <X className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-danger" />}
    </div>
  );
}

const OTP_LEN = 6;

/** Entrada de código estilo OTP: 6 quadradinhos, com auto-avanço, backspace,
 * setas e colar. O valor combinado é reportado por `onChange`. */
function OtpInput({ value, onChange, disabled, error }: { value: string; onChange: (v: string) => void; disabled?: boolean; error?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: OTP_LEN }, (_, i) => value[i] ?? "");

  function emit(arr: string[]) {
    onChange(arr.join("").replace(/\D/g, "").slice(0, OTP_LEN));
  }

  function onDigit(i: number, raw: string) {
    const only = raw.replace(/\D/g, "");
    if (!only) { // apagou
      const arr = digits.slice(); arr[i] = ""; emit(arr);
      return;
    }
    const arr = digits.slice();
    let idx = i;
    for (const c of only) { if (idx < OTP_LEN) { arr[idx] = c; idx++; } }
    emit(arr);
    refs.current[Math.min(idx, OTP_LEN - 1)]?.focus();
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      const arr = digits.slice(); arr[i - 1] = ""; emit(arr);
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < OTP_LEN - 1) {
      refs.current[i + 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const p = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LEN);
    if (!p) return;
    onChange(p);
    refs.current[Math.min(p.length, OTP_LEN - 1)]?.focus();
  }

  return (
    <div className="flex justify-center gap-2 sm:gap-2.5" onPaste={onPaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          onChange={(e) => onDigit(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          onFocus={(e) => e.currentTarget.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          aria-label={`Dígito ${i + 1}`}
          autoFocus={i === 0}
          className={cn(
            "h-12 w-11 rounded-xl border bg-surface-2 text-center text-xl font-semibold text-text transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:h-14 sm:w-12",
            error ? "border-danger" : d ? "border-primary/60" : "border-border",
          )}
        />
      ))}
    </div>
  );
}

/** Cadastro em 3 passos: dados → verificação do e-mail (código) → escolha do plano. */
export function Register() {
  const { t } = useTranslation();
  const [f, setF] = useState<Form>({ org_name: "", email: "", password: "" });
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"form" | "verify" | "plan">("form");
  const [usedCode, setUsedCode] = useState(false);
  const [codeTtl, setCodeTtl] = useState(120); // validade do código (seg), vinda do servidor

  useEffect(() => {
    api.get<{ enabled: boolean }>("/auth/registration-status").then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false));
  }, []);

  // Estado visual por campo (verde OK / vermelho inválido / neutro vazio).
  const pwErr = passwordError(f.password);
  const st = {
    org: (!f.org_name ? "" : "ok") as FieldState,
    email: (!f.email ? "" : EMAIL_RE.test(f.email) ? "ok" : "err") as FieldState,
    pw: (!f.password ? "" : pwErr ? "err" : "ok") as FieldState,
    pw2: (!pw2 ? "" : pw2 === f.password && !pwErr ? "ok" : "err") as FieldState,
  };
  const valid = !!f.org_name && EMAIL_RE.test(f.email) && !pwErr && pw2 === f.password;

  // Passo 1: valida os dados e dispara o e-mail com o código (a conta só é criada
  // no passo do plano). Se o servidor não exigir código, pula direto ao plano.
  async function next(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setErr("");
    setBusy(true);
    try {
      const r = await api.post<{ verification?: boolean; email?: string; expires_in?: number }>("/auth/register", {
        org_name: f.org_name, email: f.email, password: f.password,
      });
      setUsedCode(!!r.verification);
      setCodeTtl(r.expires_in ?? 120);
      setStep(r.verification ? "verify" : "plan");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (step === "verify")
    return <VerifyCode email={f.email} expiresIn={codeTtl} onBack={() => setStep("form")} onVerified={() => setStep("plan")} />;
  if (step === "plan")
    return <ChoosePlan email={f.email} onBack={() => setStep(usedCode ? "verify" : "form")} />;

  return (
    <AuthShell subtitle={t("auth:subtitle.register")}>
      <div className="auth-step-in space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
        {enabled === false ? (
          <p className="text-sm text-danger">{t("auth:register.disabled")} <Link to="/login" className="underline">{t("auth:register.backToLogin")}</Link>.</p>
        ) : (
          <form onSubmit={next} className="space-y-4">
            <p className="text-xs text-white/60">{t("auth:register.intro")}</p>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.org")}</label>
              <ValidatedInput state={st.org} value={f.org_name} onChange={(e) => setF({ ...f, org_name: e.target.value })} placeholder={t("auth:register.orgPlaceholder")} autoFocus />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.email")}</label>
              <ValidatedInput state={st.email} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={t("auth:register.emailPlaceholder")} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.password")}</label>
              <ValidatedInput state={st.pw} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.confirmPassword")}</label>
              <ValidatedInput state={st.pw2} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              <p className={`text-[11px] ${st.pw === "err" ? "text-danger" : st.pw === "ok" ? "text-emerald-500" : "text-white/40"}`}>{t(PASSWORD_HINT_KEY)}</p>
              {st.pw2 === "err" && <p className="text-[11px] text-danger">{t("auth:register.passwordMismatch")}</p>}
            </div>
            {err && <p className="text-sm text-danger">{err}</p>}
            <Button type="submit" className="w-full justify-center" disabled={!valid || busy}>
              {busy ? <Spinner className="border-primary-fg/40 border-t-primary-fg" /> : <>{t("auth:register.submit")} <ArrowRight className="h-4 w-4" /></>}
            </Button>
            <Link to="/login" className="block text-center text-xs text-white/60 hover:text-white">{t("auth:register.haveAccount")}</Link>
          </form>
        )}
      </div>
    </AuthShell>
  );
}

/** Passo 2: confirma o e-mail com o código de 6 dígitos (OTP) → segue para o plano.
 * O código tem validade (contador regressivo); ao expirar, reenviar gera outro. */
function VerifyCode({ email, expiresIn, onBack, onVerified }: { email: string; expiresIn: number; onBack: () => void; onVerified: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [resent, setResent] = useState(false);
  const [seconds, setSeconds] = useState(expiresIn);

  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const expired = seconds <= 0;
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 6 || expired || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api.post("/auth/verify-email", { email, code });
      onVerified(); // e-mail verificado → escolha do plano
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  async function resend() {
    setErr("");
    setResent(false);
    try {
      const r = await api.post<{ expires_in?: number }>("/auth/resend-code", { email });
      setSeconds(r.expires_in ?? 120); // reinicia o contador
      setCode("");
      setResent(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <AuthShell subtitle={t("auth:register.verify.shellSubtitle")}>
      <form onSubmit={submit} className="auth-step-in space-y-5 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white">{t("auth:register.verify.title")}</h2>
          <p className="mt-1 text-sm text-white/60">{t("auth:register.verify.subtitle", { email })}</p>
        </div>
        <OtpInput value={code} onChange={setCode} disabled={busy || expired} error={!!err || expired} />
        <p className={cn("text-center text-xs tabular-nums", expired ? "text-danger" : "text-white/50")}>
          {expired ? t("auth:register.verify.expired") : t("auth:register.verify.expiresIn", { time: mmss })}
        </p>
        {err && <p className="text-center text-sm text-danger">{err}</p>}
        {resent && <p className="text-center text-sm text-ok">{t("auth:register.verify.resent")}</p>}
        <Button type="submit" className="w-full justify-center" disabled={busy || code.length < 6 || expired}>
          {busy ? t("auth:register.verify.submitting") : <>{t("auth:register.verify.submit")} <ArrowRight className="h-4 w-4" /></>}
        </Button>
        <div className="flex items-center justify-between text-xs">
          <button type="button" onClick={onBack} className="text-white/60 hover:text-white cursor-pointer">{t("auth:register.verify.back")}</button>
          <button type="button" onClick={resend} className="text-primary hover:underline cursor-pointer">{t("auth:register.verify.resend")}</button>
        </div>
      </form>
    </AuthShell>
  );
}

/** Passo 3: escolha OBRIGATÓRIA de plano (Trial pré-selecionado) → cria a conta e loga. */
function ChoosePlan({ email, onBack }: { email: string; onBack: () => void }) {
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

  // Com o e-mail já verificado, aplica o plano → cria a conta e JÁ LOGA (guarda o token).
  async function create() {
    if (selected == null) return; // escolha obrigatória
    setBusy(true);
    setErr("");
    try {
      const r = await api.post<{ access_token: string }>("/auth/complete-registration", { email, plan_id: selected });
      tokenStore.set(r.access_token);
      window.location.assign("/"); // recarrega já autenticado
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <AuthShell subtitle={t("auth:register.choose.shellSubtitle")} wide>
      <div className="auth-step-in rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md sm:p-8">
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
