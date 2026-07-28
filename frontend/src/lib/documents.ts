/**
 * Validação de CPF/CNPJ no cliente — só para o feedback visual (verde/vermelho).
 * A validação de verdade é do back-end (app/core/documents.py); aqui espelhamos
 * a mesma lógica, inclusive o CNPJ alfanumérico (14 caracteres: 12 alfanuméricos
 * + 2 dígitos verificadores), vigente desde jul/2026.
 */

const CNPJ_RE = /^[0-9A-Z]{12}[0-9]{2}$/;

/** Sem pontuação, mantém letras/dígitos, em maiúsculas. */
export function normalizeDoc(value: string): string {
  return (value || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

function cpfValid(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(d[i]) * (size + 1 - i);
    const check = ((sum * 10) % 11) % 10;
    if (check !== Number(d[size])) return false;
  }
  return true;
}

function cnpjValid(d: string): boolean {
  // DV pelo valor ASCII-48 de cada caractere (retrocompatível com CNPJ numérico).
  if (!CNPJ_RE.test(d) || /^(.)\1{13}$/.test(d)) return false;
  const w2 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w1 = [6, ...w2];
  for (const [weights, size] of [[w2, 12], [w1, 13]] as const) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += (d.charCodeAt(i) - 48) * weights[i];
    const rest = sum % 11;
    const check = rest < 2 ? 0 : 11 - rest;
    if (check !== Number(d[size])) return false;
  }
  return true;
}

/** true se for um CPF (11 díg) ou CNPJ (14 caracteres) válido. */
export function isValidCpfCnpj(value: string): boolean {
  const d = normalizeDoc(value);
  return cpfValid(d) || cnpjValid(d);
}
