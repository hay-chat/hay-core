import { hasRouteAccess } from "@/middleware/auth.global";
import { useUserStore } from "@/stores/user";

/** Links out of the setup board, filtered by what the current role may open. */
export function useSetupLinks() {
  const userStore = useUserStore();

  const canOpen = (path: string): boolean => hasRouteAccess(path.split("?")[0], userStore.userRole);

  /**
   * Where to send people back to once they finish connecting a platform. The plugin id rides
   * along so the board can show an error next to the right row.
   */
  const setupReturnUrl = (pluginId: string): string =>
    `${window.location.origin}/setup?plugin=${encodeURIComponent(pluginId)}`;

  const connectPath = (pluginId: string): string =>
    `/integrations/plugins/${encodeURIComponent(pluginId)}?connect=1&return_to=${encodeURIComponent(setupReturnUrl(pluginId))}`;

  /** The playbook editor for a new playbook, returning to setup when saved. */
  const writePlaybookPath = "/playbooks/new?redirect=/setup";

  const playbookPath = (playbookId: string): string =>
    `/playbooks/${encodeURIComponent(playbookId)}`;

  return { canOpen, connectPath, playbookPath, writePlaybookPath };
}
