import { computed } from "vue";
import { useUserStore } from "@/stores/user";
import { useDomain } from "@/composables/useDomain";
import { buildWebchatSnippet } from "@/utils/webchat-snippet";

/**
 * The install snippet for the active organization. It needs no saved settings: the widget reads
 * those from the server, so the snippet is the same for every organization apart from its id.
 */
export function useWebchatSnippet() {
  const userStore = useUserStore();
  const { getApiUrl } = useDomain();

  const snippet = computed(() =>
    buildWebchatSnippet({
      organizationId: userStore.activeOrganizationId || "YOUR_ORG_ID",
      baseUrl: getApiUrl(),
    }),
  );

  return { snippet };
}
