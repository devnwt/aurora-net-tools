// Seletor de idioma. Usa o <Select> nativo do design system (acessível e
// navegável por teclado por padrão) + useLocale para trocar sem reload.
import { useTranslation } from "react-i18next";
import { Select } from "@/components/ui";
import { useLocale } from "@/i18n/useLocale";
import { isSupportedLocale } from "@/i18n/config";

export function LanguageSelect({ id = "language", className }: { id?: string; className?: string }) {
  const { t } = useTranslation();
  const { locale, setLocale, locales } = useLocale();

  return (
    <Select
      id={id}
      className={className}
      value={locale}
      aria-label={t("settings:preferences.languageLabel")}
      onChange={(e) => {
        const v = e.target.value;
        if (isSupportedLocale(v)) setLocale(v);
      }}
    >
      {locales.map((l) => (
        <option key={l.code} value={l.code}>
          {l.flag} {l.label}
        </option>
      ))}
    </Select>
  );
}
