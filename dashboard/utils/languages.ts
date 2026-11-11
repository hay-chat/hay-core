// The language list is shared with the server: `@hay/languages` points at
// server/types/language.types.ts (a pure module), see nuxt.config.ts.
import { languageName } from "@hay/languages";

export { LANGUAGE_CODES, isLanguageCode, languageName } from "@hay/languages";
export type { LanguageCode } from "@hay/languages";

export interface LanguageOption {
  code: string;
  /** Name in the dashboard's current language. */
  name: string;
  /** Name in English, so "German" finds "Deutsch" whatever the UI language. */
  englishName: string;
}

/** Languages named in `displayLocale`, sorted by that name. */
export function languageOptions(codes: readonly string[], displayLocale: string): LanguageOption[] {
  const collator = new Intl.Collator(displayLocale);
  return codes
    .map((code) => ({
      code,
      name: languageName(code, displayLocale),
      englishName: languageName(code, "en"),
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/** Options whose localized name, English name or code contains `query` (case and accents ignored). */
export function filterLanguageOptions(options: LanguageOption[], query: string): LanguageOption[] {
  const needle = foldText(query.trim());
  if (!needle) return options;
  return options.filter((option) =>
    [option.name, option.englishName, option.code].some((text) => foldText(text).includes(needle)),
  );
}

function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
