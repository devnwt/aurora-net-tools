/**
 * Card de vitrine de plano — versão read-only dos cards de "Meus Planos",
 * usada na tela de boas-vindas do cadastro (sem uso atual nem botão de aplicar).
 * Reaproveita as animações (plan-card / plan-float / feat-in) e a lógica de
 * características (lib/plans).
 */
import { useTranslation } from "react-i18next";
import { Check, Crown, Feather, Gift, HardDrive, Lock, Rocket, Sparkles, Users as UsersIcon, Zap, type LucideIcon } from "lucide-react";
import type { PlanOption } from "@/lib/types";
import { discountPct, featuresFor, formatBRL, isTrial, pricingFor } from "@/lib/plans";
import { Badge, Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

const TIER_ICONS: LucideIcon[] = [Feather, Zap, Rocket, Crown];

export function PlanShowcaseCard({ plan, index, recommended, yourPlan, reserveRibbon, maxFeatures, selected, onSelect, locked, compact }: {
  plan: PlanOption;
  index: number;
  recommended: boolean;
  yourPlan: boolean;
  reserveRibbon: boolean;
  maxFeatures: number;
  selected?: boolean;
  onSelect?: () => void;
  /** Plano indisponível para escolha (ex.: trial já vencido) — card esmaecido, botão travado. */
  locked?: boolean;
  /** Layout condensado (para o popup): menos espaçamento e features que somem em telas baixas. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const trial = isTrial(plan.name);
  const Icon = trial ? Gift : TIER_ICONS[Math.min(index, TIER_ICONS.length - 1)];
  const features = featuresFor(plan);
  const featBase = index * 90 + 300;
  const highlighted = (yourPlan || selected) && !locked;

  return (
    <Card
      className={cn(
        "plan-card relative flex flex-col overflow-hidden p-0",
        highlighted && "plan-current border-transparent",
        recommended && !highlighted && "ring-1 ring-accent/40",
        locked && "opacity-60 grayscale",
      )}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      {reserveRibbon && (
        <div className={cn("shrink-0", compact ? "h-6" : "h-7")}>
          {trial && (
            <div className="flex h-full items-center justify-center gap-1.5 bg-gradient-to-r from-accent/25 via-accent/15 to-accent/25 text-[11px] font-semibold uppercase tracking-wide text-accent">
              <Sparkles className="h-3 w-3" /> {t("plans:trialRibbon")}
            </div>
          )}
        </div>
      )}

      <div className={cn("relative flex flex-1 flex-col", compact ? "p-4" : "p-6")}>
        <div className={cn("pointer-events-none absolute -top-10 left-6 h-28 w-28 rounded-full blur-3xl", trial ? "bg-accent/20" : "bg-primary/20")} />

        <div className={cn("relative flex items-start justify-between", compact ? "mb-3" : "mb-5")}>
          <div className={cn(
            "plan-float grid place-items-center rounded-xl ring-1",
            compact ? "h-10 w-10" : "h-12 w-12",
            trial ? "bg-gradient-to-br from-accent/30 to-accent/10 ring-accent/40" : "bg-gradient-to-br from-primary/25 to-accent/25 ring-primary/30",
          )}>
            <Icon className={cn(compact ? "h-5 w-5" : "h-6 w-6", trial ? "text-accent" : "text-primary")} />
          </div>
          <div className="flex flex-col items-end gap-1">
            {yourPlan && <Badge tone="primary">{t("plans:yourPlan")}</Badge>}
            {trial && !highlighted && <Badge tone="accent">{t("plans:trialTag")}</Badge>}
            {recommended && !highlighted && <Badge tone="accent"><Sparkles className="mr-1 h-3 w-3" /> {t("plans:recommended")}</Badge>}
          </div>
        </div>

        <h3 className={cn("relative font-semibold", compact ? "text-lg" : "text-xl")}>{plan.name}</h3>

        {/* Preço (promo: "de" riscado + desconto, "por" em destaque). Trial = grátis. */}
        {(() => {
          const pr = pricingFor(plan.name);
          const disc = pr ? discountPct(pr) : null;
          return (
            <div className={cn("relative", compact ? "mt-2" : "mt-3")}>
              {pr ? (
                <>
                  {pr.original && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted line-through decoration-danger/60">{formatBRL(pr.original)}</span>
                      {disc && (
                        <span className="rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] font-bold text-ok">
                          -{disc}%
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-baseline gap-1">
                    <span className={cn("font-bold tracking-tight text-text", compact ? "text-2xl" : "text-3xl")}>{formatBRL(pr.price)}</span>
                    <span className="text-xs font-medium text-muted">{t("plans:perMonth")}</span>
                  </div>
                </>
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <span className={cn("font-bold tracking-tight text-accent", compact ? "text-2xl" : "text-3xl")}>{t("plans:free")}</span>
                  <span className="text-xs font-medium text-muted">{t("plans:freePeriod")}</span>
                </div>
              )}
            </div>
          );
        })()}

        <div className={cn(compact ? "mt-3 space-y-2" : "mt-5 space-y-3")}>
          <Stat icon={<HardDrive className="h-4 w-4" />} value={plan.max_devices} unit={t("plans:perDevices")} compact={compact} />
          <Stat icon={<UsersIcon className="h-4 w-4" />} value={plan.max_users} unit={t("plans:perUsers")} compact={compact} />
        </div>

        {/* Lista de recursos: em modo compacto ela some em telas de baixa altura,
            para o popup caber sem scroll (o essencial — limites e ação — permanece). */}
        <div
          className={cn(
            "border-t border-border",
            compact ? "mt-3 pt-3 [@media(max-height:820px)]:hidden" : "mt-6 pt-4",
          )}
        >
          <p className={cn("uppercase tracking-wide text-muted text-[11px]", compact ? "mb-2" : "mb-2.5")}>{t("plans:includedTitle")}</p>
          <ul className={compact ? "space-y-1.5" : "space-y-2"}>
            {features.map((f, fi) => {
              const highlight = f === "freeWeek";
              return (
                <li key={f} className="feat-in flex items-center gap-2 text-sm" style={{ animationDelay: `${featBase + fi * 70}ms` }}>
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full", highlight ? "bg-accent/20" : "bg-ok/15")}>
                    {highlight ? <Gift className="h-3 w-3 text-accent" /> : <Check className="h-3 w-3 text-ok" />}
                  </span>
                  <span className={cn(highlight ? "font-medium text-accent" : "text-text/90")}>{t(`plans:feat.${f}`)}</span>
                </li>
              );
            })}
            {Array.from({ length: Math.max(0, maxFeatures - features.length) }).map((_, k) => (
              <li key={`spacer-${k}`} aria-hidden className="invisible flex items-center gap-2 text-sm">
                <span className="grid h-4 w-4 place-items-center rounded-full"><Check className="h-3 w-3" /></span>
                <span>·</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Botão de escolha do plano (no rodapé do card). */}
        {onSelect && (
          locked ? (
            <Button variant="ghost" className={cn("w-full cursor-not-allowed justify-center", compact ? "mt-4" : "mt-6")} disabled>
              <Lock className="h-4 w-4" /> {t("plans:trialUnavailable")}
            </Button>
          ) : (
            <Button
              variant={selected ? (trial ? "accent" : "primary") : "ghost"}
              className={cn("w-full justify-center", compact ? "mt-4" : "mt-6")}
              aria-pressed={selected}
              onClick={onSelect}
            >
              {selected ? <><Check className="h-4 w-4" /> {t("plans:selected")}</> : t("plans:choosePlan", { name: plan.name })}
            </Button>
          )
        )}
      </div>
    </Card>
  );
}

function Stat({ icon, value, unit, compact }: { icon: React.ReactNode; value: number; unit: string; compact?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="flex items-center gap-1.5 text-xs text-muted">{icon} {unit}</span>
      <span className={cn("font-mono font-semibold tabular-nums", compact ? "text-xl" : "text-2xl")}>{value.toLocaleString()}</span>
    </div>
  );
}
