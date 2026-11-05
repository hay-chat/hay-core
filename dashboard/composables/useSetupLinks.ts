import { hasRouteAccess } from "@/middleware/auth.global";
import { useUserStore } from "@/stores/user";

/** Links out of the setup board, filtered by what the current role may open. */
export function useSetupLinks() {
  const userStore = useUserStore();

  const canOpen = (path: string): boolean => hasRouteAccess(path.split("?")[0], userStore.userRole);

  /** Where to send people back to once they finish connecting a platform. */
  const setupReturnUrl = (): string => `${window.location.origin}/setup`;

  const connectPath = (pluginId: string): string =>
    `/integrations/plugins/${encodeURIComponent(pluginId)}?connect=1&return_to=${encodeURIComponent(setupReturnUrl())}`;

  const playbookPath = (playbookId: string): string =>
    `/playbooks/${encodeURIComponent(playbookId)}`;

  return { canOpen, connectPath, playbookPath };
}
