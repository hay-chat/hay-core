// Locale resolution without any translation data, so the loader can use it
// without pulling every locale into widget.js.

export const SUPPORTED_LOCALES = [
  "en-us",
  "pt-br",
  "pt-pt",
  "es-es",
  "de-de",
  "it-it",
  "fr-fr",
  "nl-nl",
  "pl-pl",
  "ja-jp",
  "zh-cn",
  "ko-kr",
  "tr-tr",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

// Map language prefixes to a default locale variant
const languageFallbacks: Record<string, Locale> = {
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

function match(value: string | undefined): Locale | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if ((SUPPORTED_LOCALES as readonly string[]).includes(normalized)) return normalized as Locale;
  // Try language prefix match (e.g. "en" -> "en-us")
  return languageFallbacks[normalized.split("-")[0]] ?? null;
}

/** The configured locale, else the browser's, else English. */
export function resolveLocale(requested?: string): Locale {
  return match(requested) ?? match(navigator.language) ?? "en-us";
}
