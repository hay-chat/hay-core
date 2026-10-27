import { provide, inject, type InjectionKey } from "vue";
import enUs from "./locales/en-us";
import { resolveLocale } from "./resolve";

export type TranslationKey = keyof typeof enUs;
export type Translations = Record<TranslationKey, string>;

// English ships inside the chat chunk as the fallback; every other locale is
// its own small chunk, fetched only by visitors who need it.
const lazyLocales = import.meta.glob<{ default: Translations }>([
  "./locales/*.ts",
  "!./locales/en-us.ts",
]);

/** Load the translations for the configured (or browser) locale. */
export async function loadTranslations(requestedLocale?: string): Promise<Translations> {
  const locale = resolveLocale(requestedLocale);
  const load = lazyLocales[`./locales/${locale}.ts`];
  if (!load) return enUs;
  try {
    return (await load()).default;
  } catch (error) {
    console.warn("[Hay Webchat] Failed to load translations, using English:", error);
    return enUs;
  }
}

type TranslateFn = (key: TranslationKey) => string;

const i18nKey: InjectionKey<TranslateFn> = Symbol("hay-i18n");

/** Call in the root component to set up translations for all children. */
export function provideI18n(messages: Translations = enUs) {
  const t: TranslateFn = (key) => messages[key] ?? enUs[key] ?? key;
  provide(i18nKey, t);
  return t;
}

/** Call in any child component to get the `t()` function. */
export function useI18n(): TranslateFn {
  const t = inject(i18nKey);
  if (!t) {
    // Fallback: return English if provider was not set up (shouldn't happen)
    return (key) => enUs[key] ?? key;
  }
  return t;
}
