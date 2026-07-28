/**
 * Card de vitrine de plano — versão read-only dos cards de "Meus Planos",
 * usada na tela de boas-vindas do cadastro (sem uso atual nem botão de aplicar).
 * Reaproveita as animações (plan-card / plan-float / feat-in) e a lógica de
 * características (lib/plans).
 */
import { useTranslation } from "react-i18next";
import { Check, Crown, Feather, Gift, HardDrive, Lock, Rocket, Sparkles, Users as UsersIcon, Zap, type LucideIcon } from "lucide-react";
import type { PlanOption } from "@/lib/types";
import { featuresFor, isTrial } from "@/lib/plans";
import { Badge, Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

const TIER_ICONS: LucideIcon[] = [Feather, Zap, Rocket, Crown];

export function PlanShowcaseCard({ plan, index, recommended, yourPlan, reserveRibbon, maxFeatures, selected, onSelect, locked }: {
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
        <div className="h-7 shrink-0">
          {trial && (
            <div className="flex h-full items-center justify-center gap-1.5 bg-gradient-to-r from-accent/25 via-accent/15 to-accent/25 text-[11px] font-semibold uppercase tracking-wide text-accent">
              <Sparkles className="h-3 w-3" /> {t("plans:trialRibbon")}
            </div>
          )}
        </div>
      )}

      <div className="relative flex flex-1 flex-col p-6">
        <div className={cn("pointer-events-none absolute -top-10 left-6 h-28 w-28 rounded-full blur-3xl", trial ? "bg-accent/20" : "bg-primary/20")} />

        <div className="relative mb-5 flex items-start justify-between">
          <div className={cn(
            "plan-float grid h-12 w-12 place-items-center rounded-xl ring-1",
            trial ? "bg-gradient-to-br from-accent/30 to-accent/10 ring-accent/40" : "bg-gradient-to-br from-primary/25 to-accent/25 ring-primary/30",
          )}>
            <Icon className={cn("h-6 w-6", trial ? "text-accent" : "text-primary")} />
          </div>
          <div className="flex flex-col items-end gap-1">
            {yourPlan && <Badge tone="primary">{t("plans:yourPlan")}</Badge>}
            {trial && !highlighted && <Badge tone="accent">{t("plans:trialTag")}</Badge>}
            {recommended && !highlighted && <Badge tone="accent"><Sparkles className="mr-1 h-3 w-3" /> {t("plans:recommended")}</Badge>}
          </div>
        </div>

        <h3 className="relative text-xl font-semibold">{plan.name}</h3>

        <div className="mt-5 space-y-3">
          <Stat icon={<HardDrive className="h-4 w-4" />} value={plan.max_devices} unit={t("plans:perDevices")} />
          <Stat icon={<UsersIcon className="h-4 w-4" />} value={plan.max_users} unit={t("plans:perUsers")} />
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2.5 text-[11px] uppercase tracking-wide text-muted">{t("plans:includedTitle")}</p>
          <ul className="space-y-2">
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
            <Button variant="ghost" className="mt-6 w-full cursor-not-allowed justify-center" disabled>
              <Lock className="h-4 w-4" /> {t("plans:trialUnavailable")}
            </Button>
          ) : (
            <Button
              variant={selected ? (trial ? "accent" : "primary") : "ghost"}
              className="mt-6 w-full justify-center"
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

function Stat({ icon, value, unit }: { icon: React.ReactNode; value: number; unit: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="flex items-center gap-1.5 text-xs text-muted">{icon} {unit}</span>
      <span className="font-mono text-2xl font-semibold tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}
