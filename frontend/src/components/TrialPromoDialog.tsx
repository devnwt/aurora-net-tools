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
  { expired, trial = true, onClose }: { expired: boolean; trial?: boolean; onClose: () => void },
) {
  const { t } = useTranslation();
  const toast = useToast();
  const { logout } = useAuth();
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [cur, setCur] = useState<CurrentPlan | null>(null);
  const [applying, setApplying] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.get<PlanOption[]>("/plans"), api.get<CurrentPlan>("/plans/current")])
      .then(([ps, c]) => { setPlans(ps); setCur(c); })
      .catch(() => setPlans([]));
  }, []);

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
          <div className="flex shrink-0 justify-center border-t border-border px-5 py-3">
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