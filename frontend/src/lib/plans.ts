import type { PlanOption } from "./types";

/**
 * Características por plano (o modelo guarda só limites, então derivamos aqui).
 * O plano de teste (nome com "trial"/"grátis"/"free") troca multiusuário+backups
 * por "1 semana de gratuidade". Compartilhado entre a tela de planos e o cadastro.
 */
export const isTrial = (name: string) => /trial|gr[aá]ti|free/i.test(name);

/** Plano topo de linha (nome com "max", ex. "Pro Max") — não há para onde fazer upgrade. */
export const isMaxPlan = (name: string) => /max/i.test(name);

export const BASE_FEATURES = ["monitoring", "multiuser", "api", "backups", "copilot"] as const;
export const TRIAL_FEATURES = ["freeWeek", "monitoring", "api", "copilot"] as const;

export const featuresFor = (plan: PlanOption): readonly string[] =>
  isTrial(plan.name) ? TRIAL_FEATURES : BASE_FEATURES;

/** Preço de exibição (R$/mês) por plano. `original` (opcional) é o valor "de"
 *  riscado numa promoção; `price` é o valor "por". Trial é gratuito (null). */
export interface PlanPricing {
  price: number;
  original?: number;
}

export function pricingFor(plan: PlanOption): PlanPricing | null {
  if (isTrial(plan.name)) return null;
  // Valores definidos pelo Master (em centavos). promo = "por"; price = "de".
  const promo = plan.promo_price_cents;
  const reg = plan.price_cents;
  if (promo != null && reg != null) return { price: promo / 100, original: reg / 100 };
  if (reg != null) return { price: reg / 100 };
  if (promo != null) return { price: promo / 100 };
  // Fallback (planos ainda sem preço cadastrado): heurística por nome.
  if (isMaxPlan(plan.name)) return { price: 549.99, original: 700 };
  return { price: 150, original: 199 };
}

/** Formata em Real. Sem centavos quando o valor é inteiro (R$ 150 · R$ 549,99). */
export function formatBRL(value: number): string {
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  });
}

/** Percentual de desconto (arredondado) entre `original` e `price`. */
export function discountPct(p: PlanPricing): number | null {
  if (!p.original || p.original <= p.price) return null;
  return Math.round((1 - p.price / p.original) * 100);
}
