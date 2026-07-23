// Configuração central do i18n — idiomas suportados e metadados do seletor.
//
// Adicionar um idioma novo:
//   1. inclua o código aqui em LOCALES (code/label/flag);
//   2. crie a pasta src/i18n/locales/<code>/ com os mesmos arquivos .json dos
//      idiomas existentes (as chaves precisam existir nos 3 idiomas);
//   3. pronto — o loader (index.ts) descobre os arquivos por glob, sem mais fiação.

/** Códigos de idioma suportados. Fonte única da verdade — evite strings soltas. */
export type SupportedLocale = "pt-BR" | "en" | "es";

interface LocaleMeta {
  code: SupportedLocale;
  /** Nome do idioma no próprio idioma (exibido no seletor). */
  label: string;
  /** Bandeira (emoji) — decorativa; o label é quem dá o significado acessível. */
  flag: string;
}

/** Ordem e metadados exibidos no seletor de idioma. */
export const LOCALES: readonly LocaleMeta[] = [
  { code: "pt-BR", label: "Português", flag: "🇧🇷" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
] as const;

/** Idioma padrão e fallback global — pt-BR, conforme especificação. */
export const DEFAULT_LOCALE: SupportedLocale = "pt-BR";

export const SUPPORTED_CODES: SupportedLocale[] = LOCALES.map((l) => l.code);

/** Chave no localStorage onde a preferência persiste (refresh/logout/browser). */
export const STORAGE_KEY = "aurora_lang";

/** true se o código for um idioma que a aplicação de fato suporta. */
export function isSupportedLocale(code: string): code is SupportedLocale {
  return SUPPORTED_CODES.includes(code as SupportedLocale);
}
