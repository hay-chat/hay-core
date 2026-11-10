/**
 * Languages Hay understands: ISO 639-1 codes for living languages, plus the
 * written variants that need their own code. Dead and constructed languages
 * (Latin, Sanskrit, Esperanto, ...) are left out.
 *
 * - `pt` is Brazilian Portuguese (prompts and copy are written in it);
 *   `pt-PT` is European Portuguese.
 * - `zh` is Simplified Chinese; `zh-Hant` is Traditional Chinese.
 *
 * Names are never stored: use {@link languageName}.
 */
export const LANGUAGE_CODES = [
  "aa",
  "ab",
  "af",
  "ak",
  "am",
  "an",
  "ar",
  "as",
  "av",
  "ay",
  "az",
  "ba",
  "be",
  "bg",
  "bi",
  "bm",
  "bn",
  "bo",
  "br",
  "bs",
  "ca",
  "ce",
  "ch",
  "co",
  "cr",
  "cs",
  "cv",
  "cy",
  "da",
  "de",
  "dv",
  "dz",
  "ee",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "ff",
  "fi",
  "fj",
  "fo",
  "fr",
  "fy",
  "ga",
  "gd",
  "gl",
  "gn",
  "gu",
  "gv",
  "ha",
  "he",
  "hi",
  "ho",
  "hr",
  "ht",
  "hu",
  "hy",
  "hz",
  "id",
  "ig",
  "ii",
  "ik",
  "is",
  "it",
  "iu",
  "ja",
  "jv",
  "ka",
  "kg",
  "ki",
  "kj",
  "kk",
  "kl",
  "km",
  "kn",
  "ko",
  "kr",
  "ks",
  "ku",
  "kv",
  "kw",
  "ky",
  "lb",
  "lg",
  "li",
  "ln",
  "lo",
  "lt",
  "lu",
  "lv",
  "mg",
  "mh",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "na",
  "nb",
  "nd",
  "ne",
  "ng",
  "nl",
  "nn",
  "no",
  "nr",
  "nv",
  "ny",
  "oc",
  "oj",
  "om",
  "or",
  "os",
  "pa",
  "pl",
  "ps",
  "pt",
  "pt-PT",
  "qu",
  "rm",
  "rn",
  "ro",
  "ru",
  "rw",
  "sc",
  "sd",
  "se",
  "sg",
  "si",
  "sk",
  "sl",
  "sm",
  "sn",
  "so",
  "sq",
  "sr",
  "ss",
  "st",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "ti",
  "tk",
  "tl",
  "tn",
  "to",
  "tr",
  "ts",
  "tt",
  "tw",
  "ty",
  "ug",
  "uk",
  "ur",
  "uz",
  "ve",
  "vi",
  "wa",
  "wo",
  "xh",
  "yi",
  "yo",
  "za",
  "zh",
  "zh-Hant",
  "zu",
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const DEFAULT_LANGUAGE: LanguageCode = "en";

const LANGUAGE_CODE_SET: ReadonlySet<string> = new Set(LANGUAGE_CODES);

/** Codes browsers send that ISO 639-1 spells differently. */
const LANGUAGE_ALIASES: Record<string, LanguageCode> = { fil: "tl" };

/** Regions that write Traditional Chinese when no script is given. */
const TRADITIONAL_CHINESE_REGIONS = new Set(["TW", "HK", "MO"]);

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && LANGUAGE_CODE_SET.has(value);
}

/**
 * Map a BCP-47 tag (`sv-SE`, `pt_PT`, `zh-TW`, `iw`) to a {@link LanguageCode},
 * or null when it is empty, malformed or not a language Hay knows.
 */
export function normalizeLanguage(value: string | null | undefined): LanguageCode | null {
  const tag = value?.trim().replace(/_/g, "-");
  if (!tag) return null;

  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    return null;
  }

  const language = LANGUAGE_ALIASES[locale.language] ?? locale.language;
  if (language === "pt" && locale.region === "PT") return "pt-PT";
  if (language === "zh") {
    const traditional =
      locale.script === "Hant" ||
      (!locale.script && !!locale.region && TRADITIONAL_CHINESE_REGIONS.has(locale.region));
    return traditional ? "zh-Hant" : "zh";
  }
  return isLanguageCode(language) ? language : null;
}

/** Name of a language, written in `displayLocale` ("Dutch", or "Nederlands" for `nl`). */
export function languageName(
  code: string | null | undefined,
  displayLocale: string = DEFAULT_LANGUAGE,
): string {
  const value = code?.trim() || DEFAULT_LANGUAGE;
  try {
    return new Intl.DisplayNames([displayLocale], { type: "language" }).of(value) ?? value;
  } catch {
    return value;
  }
}
