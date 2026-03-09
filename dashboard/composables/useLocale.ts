/**
 * Maps backend SupportedLanguage codes to frontend i18n locale codes.
 * Backend uses short codes (e.g., "pt"), frontend uses regional variants (e.g., "pt-BR").
 */
const BACKEND_TO_I18N: Record<string, string> = {
  en: "en",
  pt: "pt-BR",
  // Add more mappings as new locales are translated
};

const I18N_TO_BACKEND: Record<string, string> = {
  en: "en",
  "pt-BR": "pt",
};

export function useLocale() {
  const { locale, setLocale } = useI18n();

  /**
   * Set the i18n locale from a backend SupportedLanguage value.
   * Falls back to "en" if no mapping exists.
   */
  async function setLocaleFromBackend(backendLang: string) {
    const i18nLocale = (BACKEND_TO_I18N[backendLang] || "en") as "en" | "pt-BR";
    if (locale.value !== i18nLocale) {
      await setLocale(i18nLocale);
    }
  }

  /**
   * Get the backend SupportedLanguage code from the current i18n locale.
   */
  function getBackendLocale(): string {
    return I18N_TO_BACKEND[locale.value] || "en";
  }

  return { locale, setLocaleFromBackend, getBackendLocale };
}
