type LocaleEntry = string | { code: string };

/**
 * The dashboard UI locale. A user's interface language, when set, wins over the
 * browser detection configured in nuxt.config.ts (`detectBrowserLanguage`).
 */
export function useLocale() {
  const { setLocale, locale, locales } = useNuxtApp().$i18n;

  /** Switch the UI to `code` when it is a dashboard locale; null keeps the current one. */
  async function applyInterfaceLanguage(code: string | null | undefined) {
    if (!code || code === locale.value) return;
    const match = (locales.value as LocaleEntry[])
      .map((entry) => (typeof entry === "string" ? entry : entry.code))
      .find((available) => available === code);
    if (match) await setLocale(match as Parameters<typeof setLocale>[0]);
  }

  return { locale, applyInterfaceLanguage };
}
