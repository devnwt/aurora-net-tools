/**
 * Máscaras de entrada — PURAMENTE de apresentação.
 *
 * Cada função recebe o texto digitado e devolve a versão formatada. O valor
 * resultante é sempre exatamente o que a API já espera hoje (IPv4 "192.168.0.1",
 * MAC "AA:BB:CC:DD:EE:FF", porta "8080", CIDR "10.0.0.0/24"), então aplicar a
 * máscara NÃO muda lógica de negócio, validação ou persistência — só impede o
 * usuário de digitar um formato impossível.
 *
 * Regra de ouro: a máscara nunca "conserta" além do que o back-end aceitaria.
 * Ex.: zeros à esquerda em IPv4 são removidos porque o back-end os rejeita.
 */

/** IPv4 com PONTO AUTOMÁTICO. Processa dígito a dígito e avança de octeto
 *  sozinho — o usuário digita só os números, o ponto entra na hora certa:
 *   - octeto cheio (3 dígitos) e vem outro dígito → novo octeto;
 *   - dígito faria o octeto passar de 255 (ex.: "25"+"6") → novo octeto;
 *   - ponto digitado é respeitado (fecha o octeto atual).
 *  Nunca acrescenta um ponto no FIM sozinho (senão travava o backspace).
 *  Zero à esquerda em octeto de 2+ dígitos é removido (o back-end o rejeita). */
export function maskIPv4(raw: string): string {
  const octets: string[] = [""];
  const advance = (digit: string) => {
    if (octets.length < 4) octets.push(digit); // senão, 4 octetos cheios: ignora o excedente
  };

  for (const ch of raw.replace(/[^\d.]/g, "")) {
    const cur = octets[octets.length - 1];
    if (ch === ".") {
      if (cur !== "") advance(""); // ponto explícito só fecha um octeto não-vazio
      continue;
    }
    if (cur.length < 3 && Number(cur + ch) <= 255) {
      octets[octets.length - 1] = cur + ch;
    } else {
      advance(ch);
    }
  }

  return octets.map((o) => (o.length > 1 ? String(parseInt(o, 10)) : o)).join(".");
}

/** IPv4 com prefixo CIDR opcional (ex.: "10.0.0.0/24"). Prefixo 0–32. */
export function maskIPv4Cidr(raw: string): string {
  const slash = raw.indexOf("/");
  if (slash === -1) return maskIPv4(raw);
  let prefix = raw.slice(slash + 1).replace(/\D/g, "").slice(0, 2);
  if (prefix !== "" && Number(prefix) > 32) prefix = "32";
  return `${maskIPv4(raw.slice(0, slash))}/${prefix}`;
}

/** Alvo de scan: CIDR, range (192.168.0.1-254) ou IP único. Só sanitiza os
 *  caracteres válidos (dígitos, ponto, barra, hífen) — a interpretação fica
 *  com o back-end (services/scan.py:parse_targets). */
export function maskNetworkTarget(raw: string): string {
  return raw.replace(/[^\d./-]/g, "");
}

/** MAC: hex em maiúsculas, agrupado em pares por ":", no máximo 6 grupos. */
export function maskMAC(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 12);
  return hex.match(/.{1,2}/g)?.join(":") ?? "";
}

/** Porta de rede: só dígitos, sem zero à esquerda, teto 65535. */
export function maskPort(raw: string): string {
  const d = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 5);
  return d === "" ? "" : String(Math.min(Number(d), 65535));
}

/** Coordenada decimal com sinal opcional (ex.: "-20.123456"). Não limita a
 *  faixa lat/lon (isso é validação de negócio) — só garante um número válido. */
export function maskCoordinate(raw: string): string {
  const negative = raw.trimStart().startsWith("-");
  // Vírgula decimal (teclado pt-BR) vira ponto antes de sanitizar.
  const [intPart, ...rest] = raw.replace(/,/g, ".").replace(/[^\d.]/g, "").split(".");
  const body = rest.length ? `${intPart}.${rest.join("").slice(0, 8)}` : intPart;
  return (negative ? "-" : "") + body;
}

/** Telefone brasileiro: (DD) 9XXXX-XXXX (celular, 11 díg) ou (DD) XXXX-XXXX
 *  (fixo, 10 díg). Formata progressivamente conforme digita; teto de 11 dígitos. */
export function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const cut = rest.length <= 8 ? 4 : 5; // fixo quebra em 4, celular em 5
  return `(${ddd}) ${rest.slice(0, cut)}-${rest.slice(cut)}`;
}

export type MaskName = "ipv4" | "ipv4cidr" | "network" | "mac" | "port" | "coordinate" | "phone";

/** Registro consumido pelo componente MaskedInput. `inputMode` escolhe o teclado
 *  virtual: "decimal" traz o ponto (IP/coordenada); "text" preserva A–F (MAC);
 *  "tel" abre o teclado telefônico. */
export const MASKS: Record<MaskName, { apply: (raw: string) => string; inputMode: "numeric" | "decimal" | "text" | "tel" }> = {
  ipv4: { apply: maskIPv4, inputMode: "decimal" },
  ipv4cidr: { apply: maskIPv4Cidr, inputMode: "decimal" },
  network: { apply: maskNetworkTarget, inputMode: "decimal" },
  mac: { apply: maskMAC, inputMode: "text" },
  port: { apply: maskPort, inputMode: "numeric" },
  coordinate: { apply: maskCoordinate, inputMode: "decimal" },
  phone: { apply: maskPhone, inputMode: "tel" },
};
