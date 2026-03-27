import { useI18n } from "vue-i18n";
import { HayApi } from "@/utils/api";

/**
 * Fetches plugin i18n translations from the server and merges them
 * into Vue I18n at runtime under the "plugins" namespace.
 *
 * Call `loadTranslations()` on app init and it will auto-reload on locale change.
 */
export function usePluginTranslations() {
  const { locale, mergeLocaleMessage } = useI18n({ useScope: "global" });
  const loaded = ref(false);

  async function loadTranslations() {
    try {
      const data = await HayApi.plugins.getPluginTranslations.query({
        locale: locale.value,
      });
      mergeLocaleMessage(locale.value, { plugins: data });
      loaded.value = true;
    } catch (error) {
      console.warn("Failed to load plugin translations:", error);
    }
  }

  // Reload when locale changes
  watch(locale, () => loadTranslations());

  return { loadTranslations, loaded };
}
