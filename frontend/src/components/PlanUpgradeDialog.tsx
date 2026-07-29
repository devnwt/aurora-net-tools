/**
 * Popup de troca de plano (autosserviço do admin da ORG). Abre a partir do
 * "Atualizar plano" no menu lateral e mostra os cards de plano. Selecionar um
 * card é a ação direta — o checkout viria aqui; por ora aplica na própria
 * organização (/plans/select), mostra um toast e recarrega. O card do plano de
 * teste fica travado quando a janela de elegibilidade já venceu.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, Sparkles, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { CurrentPlan, PlanOption } from "@/lib/types";
import { isTrial } from "@/lib/plans";
import { Spinner } from "@/components/ui";
import { PlanShowcaseCard } from "@/components/PlanShowcaseCard";

export function PlanUpgradeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [cur, setCur] = useState<CurrentPlan | null>(null);
  const [applying, setApplying] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.get<PlanOption[]>("/plans"), api.get<CurrentPlan>("/plans/current")])
      .then(([ps, c]) => { setPlans(ps); setCur(c); })
      .catch(() => setPlans([]));
  }, []);

  // Ao ir para o checkout e voltar pelo navegador, a página é restaurada do
  // bfcache com o loading ainda ativo — limpa o estado nesse retorno (pageshow)
  // para não ficar preso na tela de carregamento.
  useEffect(() => {
    const reset = () => setApplying(null);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const trialAvailable = cur?.trial_available !== false;
  const list = plans ?? [];
  const reserveRibbon = list.some((p) => isTrial(p.name));
  const topId = list.filter((p) => !isTrial(p.name)).reduce<PlanOption | null>((m, p) => (!m || p.max_devices > m.max_devices ? p : m), null)?.id;
  // Plano em aplicação é pago? (define o texto do loading: checkout x aplicar direto)
  const applyingPlan = applying != null ? list.find((p) => p.id === applying) : null;
  const applyingPaid = !!applyingPlan && !isTrial(applyingPlan.name);

  // Selecionar o plano. Já é o atual → só fecha. Plano PAGO → checkout: cria a
  // cobrança e redireciona para a URL de pagamento. Trial/grátis → aplica direto,
  // avisa e recarrega (atualiza o chip do menu).
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
        window.location.assign(r.payment_url); // vai para o pagamento no hub
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

  return (
    <div
      className="dlg-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="dlg-panel relative flex max-h-[92vh] w-full max-w-[95vw] flex-col rounded-2xl border border-border bg-surface shadow-2xl lg:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-3 sm:px-6">
          <div>
            <h2 className="text-base font-semibold">{t("plans:upgradeTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("plans:upgradeSubtitle")}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common:a11y.close")}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Corpo centralizado que ocupa o espaço restante SEM scroll: os cards são
            compactos e escondem a lista de recursos em telas baixas para caber. */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-5">
          {plans === null ? (
            <Spinner className="h-6 w-6" />
          ) : (
            <div className="grid w-full grid-cols-2 items-stretch gap-3 sm:gap-4 lg:grid-cols-3">
              {list.map((p, i) => (
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

        {applying != null && (
          <div className="dlg-backdrop absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-surface/80 backdrop-blur-md">
            <div className="checkout-loading flex max-w-xs flex-col items-center gap-4 px-6 text-center">
              {/* Ícone com anel pulsante */}
              <div className="relative grid place-items-center">
                <span className="absolute h-16 w-16 rounded-full bg-primary/25 motion-safe:animate-ping" />
                <span className="relative grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/30">
                  {applyingPaid ? <CreditCard className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-text">{applyingPaid ? t("plans:checkoutRedirect") : t("plans:upgradeApplying")}</p>
                {applyingPaid && <p className="text-xs leading-relaxed text-muted">{t("plans:checkoutRedirectHint")}</p>}
              </div>
              {/* Três pontinhos animados */}
              <div className="flex gap-1.5" aria-hidden="true">
                <span className="loading-dot h-1.5 w-1.5 rounded-full bg-primary" style={{ animationDelay: "0ms" }} />
                <span className="loading-dot h-1.5 w-1.5 rounded-full bg-primary" style={{ animationDelay: "160ms" }} />
                <span className="loading-dot h-1.5 w-1.5 rounded-full bg-primary" style={{ animationDelay: "320ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
