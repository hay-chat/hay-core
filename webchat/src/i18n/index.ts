import { provide, inject, type InjectionKey } from "vue";

import enUs from "./locales/en-us";
import ptBr from "./locales/pt-br";
import ptPt from "./locales/pt-pt";
import esEs from "./locales/es-es";
import deDe from "./locales/de-de";
import itIt from "./locales/it-it";
import frFr from "./locales/fr-fr";
import nlNl from "./locales/nl-nl";
import plPl from "./locales/pl-pl";
import jaJp from "./locales/ja-jp";
import zhCn from "./locales/zh-cn";
import koKr from "./locales/ko-kr";
import trTr from "./locales/tr-tr";

export type TranslationKey = keyof typeof enUs;
type Translations = Record<TranslationKey, string>;

const locales: Record<string, Translations> = {
  "en-us": enUs,
  "pt-br": ptBr,
  "pt-pt": ptPt,
  "es-es": esEs,
  "de-de": deDe,
  "it-it": itIt,
  "fr-fr": frFr,
  "nl-nl": nlNl,
  "pl-pl": plPl,
  "ja-jp": jaJp,
  "zh-cn": zhCn,
  "ko-kr": koKr,
  "tr-tr": trTr,
};

// Map language prefixes to a default locale variant
const languageFallbacks: Record<string, string> = {
  en: "en-us",
  pt: "pt-br",
  es: "es-es",
  de: "de-de",
  it: "it-it",
  fr: "fr-fr",
  nl: "nl-nl",
  pl: "pl-pl",
  ja: "ja-jp",
  zh: "zh-cn",
  ko: "ko-kr",
  tr: "tr-tr",
};

function resolveLocale(requested?: string): string {
  if (requested) {
    const normalized = requested.toLowerCase();
    if (locales[normalized]) return normalized;

    // Try language prefix match (e.g. "en" -> "en-us")
    const lang = normalized.split("-")[0];
    if (languageFallbacks[lang]) return languageFallbacks[lang];
  }

  // Auto-detect from browser
  const browserLang = navigator.language?.toLowerCase();
  if (browserLang) {
    if (locales[browserLang]) return browserLang;
    const lang = browserLang.split("-")[0];
    if (languageFallbacks[lang]) return languageFallbacks[lang];
  }

  return "en-us";
}

type TranslateFn = (key: TranslationKey) => string;

const i18nKey: InjectionKey<TranslateFn> = Symbol("hay-i18n");

/** Call in the root component to set up translations for all children. */
export function provideI18n(requestedLocale?: string) {
  const locale = resolveLocale(requestedLocale);
  const messages = locales[locale] ?? locales["en-us"];

  const t: TranslateFn = (key) => messages[key] ?? key;

  provide(i18nKey, t);
  return t;
}

/** Call in any child component to get the `t()` function. */
export function useI18n(): TranslateFn {
  const t = inject(i18nKey);
  if (!t) {
    // Fallback: return English if provider was not set up (shouldn't happen)
    const messages = locales["en-us"];
    return (key) => messages[key] ?? key;
  }
  return t;
}
