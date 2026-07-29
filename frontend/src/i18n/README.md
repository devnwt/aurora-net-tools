# Internacionalização (i18n)

A interface do Aurora Prisma NetTools é traduzida com [**i18next**](https://www.i18next.com/) + [**react-i18next**](https://react.i18next.com/) e detecção de idioma via `i18next-browser-languagedetector`.

## Idiomas disponíveis

| Código  | Idioma     | Seletor       |
|---------|------------|---------------|
| `pt-BR` | Português  | 🇧🇷 Português  |
| `en`    | Inglês     | 🇺🇸 English    |
| `es`    | Espanhol   | 🇪🇸 Español    |

**Idioma padrão e fallback:** `pt-BR`. Se faltar uma chave em qualquer idioma, o texto cai para `pt-BR` (nunca exibe `undefined`); em DEV a chave ausente é logada no console (`[i18n] chave ausente: …`).

## Como o idioma é escolhido

Em ordem (ver `detection` em `index.ts`):
1. **Preferência salva** — `localStorage["aurora_lang"]`.
2. **`pt-BR`** — padrão/fallback quando não há preferência.

> O idioma do navegador **não** é usado como padrão (a especificação exige pt-BR no primeiro acesso). Só a escolha explícita no seletor muda o idioma. Detalhe técnico: `nonExplicitSupportedLngs` fica **desligado** — com um código regional (`pt-BR`) misturado a códigos simples (`en`/`es`), ligá-lo faz o i18next procurar um bundle `pt` inexistente e devolver a chave crua.

A troca no seletor (Configurações → Preferências) chama `i18n.changeLanguage()`, que **re-renderiza a interface na hora, sem reload**, e persiste no `localStorage` (sobrevive a refresh, logout/login e ao fechar o navegador — o logout limpa só tokens de sessão legados, não a preferência de idioma).

## Onde ficam os arquivos

```
src/i18n/
  config.ts            SupportedLocale, lista LOCALES (code/label/flag), DEFAULT_LOCALE, STORAGE_KEY
  index.ts             init do i18next; carrega os locales por glob (import.meta.glob)
  useLocale.ts         hook do seletor: { locale, setLocale, locales }
  locales/
    pt-BR/  <namespace>.json   ← fonte da verdade
    en/     <namespace>.json
    es/     <namespace>.json
```

As traduções são organizadas por **namespace** (domínio), um arquivo `.json` por namespace por idioma. Namespaces atuais: `common`, `nav`, `auth`, `dashboard`, `devices`, `sites`, `credentials`, `access`, `ops`, `fiberhome`, `copilot`, `activity`, `admin`, `settings`.

O `common` guarda o que é reutilizável em toda a aplicação (ações, estados, rótulos genéricos, status de device, papéis, a11y). **Prefira reutilizar `common` a duplicar textos.**

## Como usar num componente

```tsx
import { useTranslation } from "react-i18next";

function MinhaTela() {
  const { t } = useTranslation();
  return (
    <div>
      <h1>{t("devices:title")}</h1>
      <Button>{t("common:actions.save")}</Button>
      <p>{t("settings:system.retentionValue", { days: 30 })}</p>  {/* interpolação {{days}} */}
    </div>
  );
}
```

Convenção: **toda chave é qualificada por namespace** — `t("<namespace>:<chave>")`. Fora de componentes (funções utilitárias), use a instância direta: `import i18n from "@/i18n"; i18n.t("common:state.error")`.

## Como adicionar uma nova chave

1. Adicione a chave no `pt-BR/<namespace>.json` (fonte da verdade).
2. Replique a **mesma chave** em `en/` e `es/` com a tradução real. Todas as chaves precisam existir nos 3 idiomas.
3. Use com `t("<namespace>:<chave>")`.

Para um **namespace novo**, basta criar `locales/<idioma>/<novo-ns>.json` nos 3 idiomas — o loader (`index.ts`) descobre por glob, sem editar nada mais.

## Como adicionar um novo idioma

1. Em `config.ts`, adicione o código em `SupportedLocale` e uma entrada em `LOCALES` (`code`/`label`/`flag`).
2. Crie a pasta `locales/<code>/` com **todos** os `.json` dos idiomas existentes, traduzidos.
3. Pronto — ele aparece no seletor e passa a ser detectável.

## O que NÃO traduzir

Nomes técnicos de APIs/endpoints, campos internos, comandos de equipamento (RouterOS/Cisco/Huawei/TL1), nomes de protocolos (SSH/SNMP/Telnet/TL1/REST/API), nomes de variáveis de ambiente, e **qualquer conteúdo bruto vindo do equipamento ou do backend** (saídas, mensagens de erro técnicas). A regra de UX: mostrar uma mensagem amigável traduzida e manter o detalhe técnico cru disponível para diagnóstico.

## Formatação (datas/números)

A infraestrutura já expõe o idioma atual (`i18n.language`), então formatações com `toLocaleTimeString(i18n.language)` / `Intl.*` seguem o idioma. Nesta primeira fase o foco é a tradução de textos; formatação de data/número/moeda pode evoluir sobre essa base.
