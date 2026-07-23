// Inicialização do i18next (react-i18next + detecção de idioma).
//
// Como funciona:
//   - As traduções ficam em ./locales/<code>/<namespace>.json e são carregadas
//     por glob (import.meta.glob, eager). Adicionar um namespace ou idioma novo
//     NÃO exige editar este arquivo — basta criar o .json.
//   - O idioma vem, em ordem: preferência salva (localStorage "aurora_lang") →
//     idioma do navegador → pt-BR (fallback). Trocar o idioma persiste sozinho.
//   - Chave faltando cai no fallback pt-BR (nunca exibe undefined); em DEV o
//     problema é logado no console.
//
// Convenção de uso nos componentes:
//   const { t } = useTranslation();
//   t("common:actions.save")     // sempre <namespace>:<chave>
//   t("devices:list.title")
//
// Ver src/i18n/config.ts para idiomas suportados e o guia de manutenção.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { DEFAULT_LOCALE, STORAGE_KEY, SUPPORTED_CODES } from "./config";

// Carrega todo ./locales/<lng>/<ns>.json de uma vez (Vite resolve em build time).
const modules = import.meta.glob("./locales/**/*.json", { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const m = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  const [, lng, ns] = m;
  (resources[lng] ??= {})[ns] = mod.default;
}

/** Namespaces descobertos nos arquivos de locale (união de todos os idiomas). */
export const NAMESPACES = Array.from(
  new Set(Object.values(resources).flatMap((ns) => Object.keys(ns))),
).sort();

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LOCALE,
    // Só os 3 códigos exatos; NÃO usar nonExplicitSupportedLngs — com um código
    // regional (pt-BR) misturado a códigos simples (en/es) ele remove a região e
    // procura um bundle "pt" inexistente, devolvendo a chave crua.
    supportedLngs: SUPPORTED_CODES,
    ns: NAMESPACES,
    defaultNS: "common",
    fallbackNS: "common",
    interpolation: { escapeValue: false }, // React já escapa; evita &amp; etc.
    detection: {
      // Só a preferência salva. Sem preferência = pt-BR (o fallback) — o padrão
      // não é o idioma do navegador, conforme especificação.
      order: ["localStorage"],
      lookupLocalStorage: STORAGE_KEY,
      caches: ["localStorage"],
    },
    react: { useSuspense: false }, // tudo é eager; sem estado de carregamento assíncrono
    returnNull: false,
    // Em DEV, avisa no console quando uma chave não existe (nunca em produção).
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: import.meta.env.DEV
      ? (_lng, ns, key) => console.warn(`[i18n] chave ausente: ${ns}:${key}`)
      : undefined,
  });

export default i18n;
