import { computed, ref } from "vue";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";

/**
 * The team's "Pause AI everywhere" switch (D11-9). The server pushes the new
 * state to every open dashboard (organization_access_changed); the caller's
 * own store is updated right away so the banner reacts without waiting.
 */
const busy = ref(false);

export function useAiPause() {
  const userStore = useUserStore();

  const paused = computed(() => userStore.isAiPausedByTeam);
  const canManage = computed(() => userStore.hasScope("organization_settings", "update"));

  const setPaused = async (value: boolean): Promise<boolean> => {
    const organizationId = userStore.activeOrganizationId;
    if (!organizationId) return false;
    busy.value = true;
    try {
      const result = await Hay.organizations.setAiPause.mutate({ paused: value });
      const organization = userStore.organizations.find((org) => org.id === organizationId);
      if (organization) {
        organization.aiPausedAt = result.pausedAt;
        organization.aiPausedByUserId = value ? (userStore.user?.id ?? null) : null;
      }
      return true;
    } catch (error) {
      console.error("[AiPause] update failed:", error);
      return false;
    } finally {
      busy.value = false;
    }
  };

  return { paused, canManage, busy, setPaused };
}
