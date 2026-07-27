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
