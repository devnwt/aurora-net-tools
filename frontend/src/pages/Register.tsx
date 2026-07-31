import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Eye, EyeOff, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { PlanOption } from "@/lib/types";
import { isTrial } from "@/lib/plans";
import { Button, Input, Spinner } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { WhatsAppSupport } from "@/components/WhatsAppSupport";
import { PASSWORD_HINT_KEY, passwordError } from "@/lib/password";
import { maskCpfCnpj } from "@/lib/masks";
import { isValidCpfCnpj } from "@/lib/documents";
import { cn } from "@/lib/utils";

interface PublicPlans {
  plans: PlanOption[];
  default_plan_id: number | null;
}
type Form = { org_name: string; name: string; email: string; document: string; password: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
type FieldState = "" | "ok" | "err";

/** Input com validação visual: borda verde quando OK, vermelha quando inválido,
 * neutra quando vazio — com ícone à direita. */
function ValidatedInput({ state, className, reveal, type, ...props }: { state: FieldState; reveal?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const marked = state === "ok" || state === "err"; // tem ícone de validação à direita
  const effType = reveal ? (show ? "text" : "password") : type;
  return (
    <div className="relative">
      <Input
        {...props}
        type={effType}
        className={cn(
          "transition-colors",
          state === "ok" && "border-emerald-500 focus-visible:ring-emerald-500",
          state === "err" && "border-danger focus-visible:ring-danger",
          reveal ? (marked ? "pr-16" : "pr-10") : (marked ? "pr-9" : undefined),
          className,
        )}
      />
      {reveal && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          aria-label={t(show ? "common:a11y.hidePassword" : "common:a11y.showPassword")}
          className={cn("absolute top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:text-text cursor-pointer", marked ? "right-8" : "right-2")}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
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

/** Cadastro em 2 passos: dados → código do e-mail. Ao confirmar o código, a conta
 *  é criada direto no TRIAL e o usuário vai para a home (o popup de planos sobe lá). */
export function Register() {
  const { t } = useTranslation();
  const [f, setF] = useState<Form>({ org_name: "", name: "", email: "", document: "", password: "" });
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"form" | "verify">("form");
  const [codeTtl, setCodeTtl] = useState(120); // validade do código (seg), vinda do servidor
  const [emailSent, setEmailSent] = useState(true); // se o código foi realmente enviado por e-mail
  const [supportUrl, setSupportUrl] = useState(""); // link de suporte (WhatsApp), do backend

  useEffect(() => {
    api.get<{ enabled: boolean; support_whatsapp_url?: string }>("/auth/registration-status")
      .then((r) => { setEnabled(r.enabled); setSupportUrl(r.support_whatsapp_url || ""); })
      .catch(() => setEnabled(false));
  }, []);

  // Estado visual por campo (verde OK / vermelho inválido / neutro vazio).
  const pwErr = passwordError(f.password);
  const docOk = isValidCpfCnpj(f.document);
  const st = {
    org: (!f.org_name ? "" : "ok") as FieldState,
    name: (!f.name ? "" : "ok") as FieldState,
    email: (!f.email ? "" : EMAIL_RE.test(f.email) ? "ok" : "err") as FieldState,
    doc: (!f.document ? "" : docOk ? "ok" : "err") as FieldState,
    pw: (!f.password ? "" : pwErr ? "err" : "ok") as FieldState,
    pw2: (!pw2 ? "" : pw2 === f.password && !pwErr ? "ok" : "err") as FieldState,
  };
  const valid = !!f.org_name && !!f.name.trim() && EMAIL_RE.test(f.email) && docOk && !pwErr && pw2 === f.password;

  // Cria a conta no plano TRIAL (grátis por 7 dias) e vai direto para a home — o
  // popup de planos sobe lá ao logar. Não há passo de escolher plano no cadastro.
  async function finish() {
    const pl = await api.get<PublicPlans>("/auth/plans");
    const trial = pl.plans.find((p) => isTrial(p.name));
    await api.post("/auth/complete-registration", { email: f.email, plan_id: trial?.id ?? null });
    window.location.assign("/"); // cookie HttpOnly já autenticado
  }

  // Passo 1: valida os dados e dispara o código por e-mail. Se o servidor não exigir
  // código (sem SMTP), já cria a conta no trial e entra.
  async function next(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setErr("");
    setBusy(true);
    try {
      const r = await api.post<{ verification?: boolean; expires_in?: number; email_sent?: boolean }>("/auth/register", {
        org_name: f.org_name, name: f.name.trim(), email: f.email, document: f.document, password: f.password,
      });
      setCodeTtl(r.expires_in ?? 120);
      if (r.verification) {
        setEmailSent(r.email_sent ?? false); // se o e-mail falhou, a tela de código mostra o retry
        setStep("verify");
      } else {
        await finish();
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (step === "verify")
    return <VerifyCode email={f.email} expiresIn={codeTtl} emailSent={emailSent} supportUrl={supportUrl} onBack={() => setStep("form")} onVerified={finish} />;

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
              <label className="text-xs text-white/60">{t("auth:register.name")}</label>
              <ValidatedInput state={st.name} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("auth:register.namePlaceholder")} autoComplete="name" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.email")}</label>
              <ValidatedInput state={st.email} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={t("auth:register.emailPlaceholder")} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.document")}</label>
              <ValidatedInput state={st.doc} inputMode="text" value={f.document} onChange={(e) => setF({ ...f, document: maskCpfCnpj(e.target.value) })} placeholder={t("auth:register.documentPlaceholder")} className="font-mono" />
              {st.doc === "err" && <p className="text-[11px] text-danger">{t("auth:register.documentInvalid")}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">{t("auth:register.password")}</label>
              <ValidatedInput state={st.pw} type="password" reveal autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
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

/** Passo 2: confirma o e-mail com o código de 6 dígitos (OTP). Ao confirmar, cria a
 * conta no trial e vai para a home. O código tem validade (contador regressivo). */
const RESEND_COOLDOWN = 60; // s entre reenvios (espelha o backend) — evita spam de e-mail

function VerifyCode(
  { email, expiresIn, emailSent, supportUrl, onBack, onVerified }:
    { email: string; expiresIn: number; emailSent: boolean; supportUrl: string; onBack: () => void; onVerified: () => Promise<void> },
) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [resent, setResent] = useState(false);
  const [seconds, setSeconds] = useState(expiresIn);
  const [sent, setSent] = useState(emailSent);          // e-mail realmente enviado?
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN); // s até poder reenviar

  useEffect(() => {
    const id = window.setInterval(() => {
      setSeconds((s) => (s > 0 ? s - 1 : 0));
      setCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
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
      await onVerified(); // e-mail verificado → cria a conta no trial e vai pra home
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return; // trava o reenvio até o cooldown zerar (timing óbvio)
    setErr("");
    setResent(false);
    try {
      const r = await api.post<{ expires_in?: number; email_sent?: boolean; cooldown?: number }>("/auth/resend-code", { email });
      setSeconds(r.expires_in ?? 120); // reinicia a validade do código
      setCooldown(r.cooldown ?? RESEND_COOLDOWN); // reinicia o cooldown do reenvio
      setSent(r.email_sent ?? false);
      setCode("");
      if (r.email_sent) setResent(true); // só confirma "reenviado" se saiu de fato
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setCooldown(e.retryAfter ?? RESEND_COOLDOWN);
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
        {!sent && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-center text-xs text-amber-200">
            {t("auth:register.verify.emailFailed")}
            {supportUrl && (
              <div className="mt-2 flex justify-center">
                <WhatsAppSupport url={supportUrl} label={t("plans:supportWhatsapp")} />
              </div>
            )}
          </div>
        )}
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
          <button
            type="button"
            onClick={resend}
            disabled={cooldown > 0}
            className={cn(cooldown > 0 ? "cursor-not-allowed text-white/30" : "cursor-pointer text-primary hover:underline")}
          >
            {cooldown > 0 ? t("auth:register.verify.resendIn", { seconds: cooldown }) : t("auth:register.verify.resend")}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
