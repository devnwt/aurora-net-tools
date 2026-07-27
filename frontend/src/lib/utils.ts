import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Valida um IPv4 estrito (quatro octetos 0–255, sem zeros à esquerda — o
 * back-end os rejeita por ambiguidade com octal, então espelhamos aqui).
 */
export function isIPv4(value: string): boolean {
  const parts = value.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && (p === "0" || !p.startsWith("0")) && Number(p) <= 255);
}
