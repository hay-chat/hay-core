import { z } from "zod";
import { authenticatedProcedure } from "@server/trpc";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { getPluginRunnerService } from "@server/services/plugin-runner.service";
import { resolveConfigForWorker } from "@server/lib/config-resolver";
import { configEnvAllowList } from "@server/lib/plugin-env";
import type { ConfigFieldDescriptor, PluginMetadata } from "@server/types/plugin-sdk.types";
import { createLogger } from "@server/lib/logger";
import { workerFetch } from "@server/lib/worker-client";

const logger = createLogger("plugins");

/** How long the Setup tab waits for a plugin to report its status. */
const SETUP_STATUS_TIMEOUT_MS = 5000;

/** The standard status contract a plugin returns from `POST /setup/status`. */
export const setupStatusSchema = z.object({
  state: z.enum(["not_set_up", "needs_action", "connected", "error"]),
  account: z.string().max(200).optional(),
  steps: z
    .record(z.string(), z.object({ done: z.boolean(), message: z.string().max(200).optional() }))
    .default({}),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

/**
 * What the plugin reports about its own setup, or null when it declares no
 * status handler, is not enabled, or does not answer in time. The dashboard
 * then judges the status from what core knows.
 */
export const getSetupStatus = authenticatedProcedure
  .input(z.object({ pluginId: z.string() }))
  .query(async ({ ctx, input }): Promise<SetupStatus | null> => {
    const plugin = pluginManagerService.getPlugin(input.pluginId);
    const metadata = plugin?.metadata as PluginMetadata | undefined;
    if (!metadata?.setup?.hasStatus) return null;

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      ctx.organizationId!,
      input.pluginId,
    );
    if (!instance?.enabled) return null;

    try {
      const config = resolveConfigForWorker(
        instance.config,
        instance.authState,
        (metadata.configSchema ?? {}) as Record<string, ConfigFieldDescriptor>,
        configEnvAllowList(plugin),
      );
      const runner = getPluginRunnerService();
      const worker =
        runner.getWorker(ctx.organizationId!, input.pluginId) ??
        (await runner.startWorker(ctx.organizationId!, input.pluginId));

      const response = await workerFetch(worker.port, "/setup/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, authState: instance.authState ?? null }),
        signal: AbortSignal.timeout(SETUP_STATUS_TIMEOUT_MS),
      });
      if (!response.ok) {
        logger.warn(
          { pluginId: input.pluginId, status: response.status },
          "Plugin setup status request failed",
        );
        return null;
      }
      const parsed = setupStatusSchema.safeParse(await response.json());
      if (!parsed.success) {
        logger.warn({ pluginId: input.pluginId }, "Plugin returned an invalid setup status");
        return null;
      }
      return parsed.data;
    } catch (error) {
      logger.warn({ err: error, pluginId: input.pluginId }, "Plugin setup status unavailable");
      return null;
    }
  });
