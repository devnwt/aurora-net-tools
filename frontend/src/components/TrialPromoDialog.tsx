/**
 * Popup de vitrine de planos mostrado no login para contas em plano de teste.
 *
 * Dois modos:
 * - trial ATIVO (ainda dentro do prazo): modal DISPENSÁVEL — "Agora não" fecha.
 * - trial VENCIDO: modal INFECHÁVEL — sem botão de fechar, sem clique no backdrop;
 *   a única saída sem escolher um plano pago é sair (logout). Espelha o
 *   SetPasswordDialog (z-[60], backdrop blur, botão de logout no rodapé).
 *
   A escolha do plano segue o mesmo fluxo do PlanUpgradeDialog: trial → /plans/select,
 * pago → /plans/checkout (redireciona ao hub de cobrança).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gift, LogOut, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { CurrentPlan, PlanOption } from "@/lib/types";
import { isTrial } from "@/lib/plans";
import { Button, Spinner } from "@/components/ui";
import { PlanShowcaseCard } from "@/components/PlanShowcaseCard";

export function TrialPromoDialog(
  { expired, trial = true, canPay = true, onClose }:
    { expired: boolean; trial?: boolean; canPay?: boolean; onClose: () => void },
) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, logout } = useAuth();
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [cur, setCur] = useState<CurrentPlan | null>(null);
  const [applying, setApplying] = useState<number | null>(null);

  useEffect(() => {
    if (!canPay) return; // operador não paga: /plans é admin-only, não busca
    Promise.all([api.get<PlanOption[]>("/plans"), api.get<CurrentPlan>("/plans/current")])
      .then(([ps, c]) => { setPlans(ps); setCur(c); })
      .catch(() => setPlans([]));
  }, [canPay]);

  // Botão de suporte (WhatsApp) — só aparece se a URL vier do backend (.env).
  const supportUrl = user?.support_whatsapp_url || "";
  const supportBtn = supportUrl ? (
    <a
      href={supportUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#25D366] hover:bg-[#25D366]/10 cursor-pointer"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.892c0 2.096.549 4.142 1.595 5.945L0 24l6.335-1.652a11.9 11.9 0 005.71 1.454h.005c6.585 0 11.946-5.359 11.949-11.893a11.821 11.821 0 00-3.484-8.463"/>
      </svg>
      {t("plans:supportWhatsapp")}
    </a>
  ) : null;

  // Usuário da empresa SEM permissão de pagar (operador) com plano vencido: bloqueia
  // com um aviso da situação e a opção de sair (o plano é responsabilidade do admin).
  if (!canPay) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
      >
        <div className="dlg-panel w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-2xl">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-danger/15 text-danger">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">{t("plans:planExpiredMemberTitle")}</h2>
          <p className="mt-2 text-sm text-muted">{t("plans:planExpiredMemberSubtitle")}</p>
          <div className="mt-6 flex items-center justify-center gap-2">
            {supportBtn}
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" /> {t("plans:trialExpiredLogout")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const trialAvailable = cur?.trial_available !== false;
  const list = plans ?? [];
  const reserveRibbon = list.some((p) => isTrial(p.name));
  const topId = list.filter((p) => !isTrial(p.name)).reduce<PlanOption | null>((m, p) => (!m || p.max_devices > m.max_devices ? p : m), null)?.id;

  // Selecionar o plano. Pago → checkout (redireciona ao pagamento); trial → aplica
  // direto (só enquanto a janela de elegibilidade não venceu).
  async function choose(planId: number) {
    if (applying != null) return;
    if (planId === cur?.plan_id) { onClose(); return; }
    const plan = list.find((p) => p.id === planId);
    const paid = !!plan && !isTrial(plan.name);
    setApplying(planId);
    try {
      if (paid) {
        const r = await api.post<{ payment_url: string }>("/plans/checkout", { plan_id: planId });
        localStorage.setItem("aurora_pay_pending", String(planId)); // watcher observa até confirmar
        toast.info(t("plans:checkoutRedirect"));
        window.location.assign(r.payment_url);
        return;
      }
      await api.post<CurrentPlan>("/plans/select", { plan_id: planId });
      toast.success(t("plans:upgradeApplied"));
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e : t("plans:upgradeFailed"), { title: t("plans:upgradeFailed") });
      setApplying(null);
    }
  }

  const backdrop = expired
    ? "fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    : "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm";

  return (
    <div
      className={backdrop}
      onClick={expired ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="dlg-panel relative flex max-h-[92vh] w-full max-w-[95vw] flex-col rounded-2xl border border-border bg-surface shadow-2xl lg:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-3 sm:px-6">
          <div className="flex items-start gap-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${expired ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent"}`}>
              {expired ? <Sparkles className="h-5 w-5" /> : <Gift className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-base font-semibold">
                {expired
                  ? t(trial ? "plans:trialExpiredTitle" : "plans:planExpiredTitle")
                  : t("plans:trialPromoTitle")}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {expired
                  ? t(trial ? "plans:trialExpiredSubtitle" : "plans:planExpiredSubtitle")
                  : t("plans:trialPromoSubtitle")}
              </p>
            </div>
          </div>
          {!expired && (
            <button
              onClick={onClose}
              aria-label={t("common:a11y.close")}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-5">
          {plans === null ? (
            <Spinner className="h-6 w-6" />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted">{t("plans:empty")}</p>
          ) : (
            <div className="grid w-full grid-cols-2 items-stretch gap-3 sm:gap-4 lg:grid-cols-3">
              {/* Trial expirado: esconde o card de teste (não pode mais ser escolhido).
                  SempreDHOW os pagos para forçar a decisão. */}
              {list.filter((p) => !(expired && isTrial(p.name))).map((p, i) => (
                <PlanShowcaseCard
                  key={p.id}
                  plan={p}
                  index={i}
                  compact
                  recommended={p.id === topId}
                  yourPlan={p.id === cur?.plan_id}
                  reserveRibbon={reserveRibbon}
                  maxFeatures={5}
                  selected={applying != null ? applying === p.id : p.id === cur?.plan_id}
                  locked={isTrial(p.name) && !trialAvailable}
                  onSelect={() => choose(p.id)}
                />
              ))}
            </div>
          )}
        </div>

        {!expired && (
          <div className="flex shrink-0 justify-end border-t border-border px-5 py-3">
            <Button variant="ghost" onClick={onClose}>{t("plans:trialPromoLater")}</Button>
          </div>
        )}
        {expired && (
          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border px-5 py-3">
            {supportBtn}
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" /> {t("plans:trialExpiredLogout")}
            </button>
          </div>
        )}

        {applying != null && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/40 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Spinner className="h-5 w-5" /> {t("plans:upgradeApplying")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}