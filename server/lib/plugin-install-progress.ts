/**
 * Live progress for `plugins.enable`. A first connect can install
 * dependencies and build the plugin, which takes several seconds; the
 * dashboard shows each step as it happens. Events go to the organization's
 * sockets and the client keeps only those carrying its own `progressId`.
 */
export const PLUGIN_INSTALL_PROGRESS_EVENT = "plugin:install-progress";

export type PluginInstallStep = "install" | "build" | "enable" | "start";
export type PluginInstallStepStatus = "active" | "done" | "skipped" | "failed";

export interface PluginInstallProgressPayload {
  progressId: string;
  pluginId: string;
  step: PluginInstallStep;
  status: PluginInstallStepStatus;
}

export interface PluginInstallProgress {
  mark(step: PluginInstallStep, status: PluginInstallStepStatus): void;
  /** Marks the step active, runs it, then done; failed (and rethrows) on error. */
  run<T>(step: PluginInstallStep, work: () => Promise<T>): Promise<T>;
}

// Loaded on first use: websocket.service reaches the tRPC router, which imports
// the plugins route that uses this file. One shared promise keeps events in order.
let websocketServicePromise: Promise<
  (typeof import("@server/services/websocket.service"))["websocketService"]
> | null = null;
const getWebsocketService = () =>
  (websocketServicePromise ??= import("@server/services/websocket.service").then(
    (module) => module.websocketService,
  ));

export function createPluginInstallProgress(
  organizationId: string,
  pluginId: string,
  progressId: string | undefined,
): PluginInstallProgress {
  const mark = (step: PluginInstallStep, status: PluginInstallStepStatus) => {
    if (!progressId) return;
    const payload: PluginInstallProgressPayload = { progressId, pluginId, step, status };
    void getWebsocketService().then((websocketService) =>
      websocketService.sendToOrganization(organizationId, {
        type: PLUGIN_INSTALL_PROGRESS_EVENT,
        payload,
      }),
    );
  };

  return {
    mark,
    async run(step, work) {
      mark(step, "active");
      try {
        const result = await work();
        mark(step, "done");
        return result;
      } catch (error) {
        mark(step, "failed");
        throw error;
      }
    },
  };
}
