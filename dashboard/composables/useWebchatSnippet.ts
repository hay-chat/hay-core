import { computed, ref } from "vue";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import { useDomain } from "@/composables/useDomain";
import { buildWebchatSnippet } from "@/utils/webchat-snippet";

/**
 * The install snippet for the organization's saved web chat settings, for places that show it
 * without the settings form. The settings page builds the same snippet from its own form so
 * unsaved edits show up there.
 */
export function useWebchatSnippet() {
  const userStore = useUserStore();
  const { getApiUrl } = useDomain();

  const settings = ref<Awaited<ReturnType<typeof Hay.webchat.getSettings.query>> | null>(null);
  const loading = ref(false);
  const failed = ref(false);

  const load = async () => {
    if (loading.value || settings.value) return;
    loading.value = true;
    failed.value = false;
    try {
      settings.value = await Hay.webchat.getSettings.query();
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
  };

  const snippet = computed(() => {
    const s = settings.value;
    if (!s) return "";
    return buildWebchatSnippet({
      organizationId: userStore.activeOrganizationId || "YOUR_ORG_ID",
      baseUrl: getApiUrl(),
      widgetTitle: s.widgetTitle,
      widgetSubtitle: s.widgetSubtitle || "",
      position: s.position,
      theme: s.theme,
      isEnabled: s.isEnabled,
      showGreeting: s.showGreeting,
      greetingMessage: s.greetingMessage || "",
    });
  });

  return {
    snippet,
    enabled: computed(() => settings.value?.isEnabled ?? true),
    loading,
    failed,
    load,
  };
}
