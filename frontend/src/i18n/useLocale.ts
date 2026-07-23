// Hook do seletor de idioma. Encapsula o i18next para o resto do app não
// depender da lib diretamente e a troca ficar tipada (SupportedLocale).
import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE, isSupportedLocale, LOCALES, type SupportedLocale } from "./config";

export interface UseLocale {
  /** Idioma atual (sempre um SupportedLocale — cai no padrão se vier algo estranho). */
  locale: SupportedLocale;
  /** Troca o idioma na hora (sem reload) e persiste no localStorage. */
  setLocale: (code: SupportedLocale) => void;
  /** Lista para renderizar o seletor (code/label/flag). */
  locales: typeof LOCALES;
}

export function useLocale(): UseLocale {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;
  const locale: SupportedLocale = isSupportedLocale(current) ? current : DEFAULT_LOCALE;

  return {
    locale,
    setLocale: (code) => {
      void i18n.changeLanguage(code); // dispara re-render em todo useTranslation + persiste (caches: localStorage)
    },
    locales: LOCALES,
  };
}
