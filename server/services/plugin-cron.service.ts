/**
 * Plugin Cron Service (HAY-221)
 *
 * Bridges plugin-declared cron jobs (SDK `register.cron`) onto the platform
 * scheduler. Plugins run out-of-process and their workers are idle-killed, so the
 * worker cannot own a schedule. Instead, for every org that has a plugin enabled,
 * this service registers one job per declared cron in the central
 * {@link SchedulerService}. When a job fires it:
 *
 *   1. resolves the org's (decrypted) config + auth state,
 *   2. ensures the org+plugin worker is running,
 *   3. POSTs `/cron/:name` to the worker so the handler runs in-process, and
 *   4. if the handler staged a credential update, persists it and restarts the
 *      worker so the running MCP server picks up the fresh credentials.
 *
 * Jobs are registered on plugin enable and unregistered on disable.
 */

import { schedulerService } from "./scheduler.service";
import { getPluginRunnerService } from "./plugin-runner.service";
import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { resolveConfigForWorker } from "@server/lib/config-resolver";
import { createLogger } from "@server/lib/logger";
import type {
  AuthState,
  ConfigFieldDescriptor,
  CronJobDescriptor,
} from "../types/plugin-sdk.types";

const logger = createLogger("plugin-cron");

/** Build the platform scheduler job name for a plugin cron. */
function jobName(pluginId: string, orgId: string, cronName: string): string {
  return `plugin-cron:${pluginId}:${orgId}:${cronName}`;
}

export class PluginCronService {
  /** Track registered job names per `${orgId}:${pluginId}` so we can unregister. */
  private registered = new Map<string, string[]>();

  /**
   * Register cron jobs for every currently-enabled plugin instance that declares
   * crons. Called once at boot, after the plugin manager has populated metadata.
   */
  async initialize(): Promise<void> {
    try {
      const enabled = await pluginInstanceRepository.findAll({
        where: { enabled: true },
        relations: ["plugin"],
      });

      let registered = 0;
      for (const instance of enabled) {
        const crons = (instance.plugin?.metadata?.crons ?? []) as CronJobDescriptor[];
        if (!crons.length) continue;
        await this.registerForInstance(instance.organizationId, instance.plugin.pluginId);
        registered += crons.length;
      }

      logger.info({ registered }, "Plugin cron jobs initialized");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize plugin cron jobs");
    }
  }

  /**
   * (Re)register all cron jobs declared by a plugin for one org. Idempotent —
   * existing jobs for this org+plugin are unregistered first.
   */
  async registerForInstance(orgId: string, pluginId: string): Promise<void> {
    this.unregisterForInstance(orgId, pluginId);

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(orgId, pluginId);
    if (!instance) return;

    const crons = (instance.plugin?.metadata?.crons ?? []) as CronJobDescriptor[];
    if (!crons.length) return;

    const names: string[] = [];
    for (const cron of crons) {
      const name = jobName(pluginId, orgId, cron.name);
      const maxRetries = cron.retryPolicy?.maxRetries ?? 0;

      try {
        schedulerService.registerJob({
          name,
          description: `Plugin cron "${cron.name}" for ${pluginId} (org ${orgId})`,
          schedule: cron.schedule,
          handler: () => this.runCron(orgId, pluginId, cron.name),
          singleton: true,
          retryOnFailure: maxRetries > 0,
          maxRetries,
          enabled: true,
        });
        names.push(name);
        logger.info({ name, schedule: cron.schedule }, "Registered plugin cron job");
      } catch (error) {
        logger.error({ err: error, name }, "Failed to register plugin cron job");
      }
    }

    if (names.length) {
      this.registered.set(`${orgId}:${pluginId}`, names);
    }
  }

  /** Unregister all cron jobs previously registered for an org+plugin. */
  unregisterForInstance(orgId: string, pluginId: string): void {
    const key = `${orgId}:${pluginId}`;
    const names = this.registered.get(key);
    if (!names) return;

    for (const name of names) {
      try {
        schedulerService.unregisterJob(name);
      } catch (error) {
        logger.warn({ err: error, name }, "Failed to unregister plugin cron job");
      }
    }
    this.registered.delete(key);
  }

  /**
   * Execute a single plugin cron job: wake the worker, POST the handler, and
   * persist + propagate any credential update it staged.
   */
  private async runCron(orgId: string, pluginId: string, cronName: string): Promise<void> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(orgId, pluginId);
    if (!instance || !instance.enabled) {
      // Plugin was disabled between scheduling and firing — clean up.
      this.unregisterForInstance(orgId, pluginId);
      return;
    }

    const configSchema = (instance.plugin?.metadata?.configSchema ?? {}) as Record<
      string,
      ConfigFieldDescriptor
    >;
    const resolvedConfig = resolveConfigForWorker(
      instance.config,
      instance.authState,
      configSchema,
    );

    const runner = getPluginRunnerService();
    let worker = runner.getWorker(orgId, pluginId);
    if (!worker) {
      worker = await runner.startWorker(orgId, pluginId);
    }

    const response = await fetch(
      `http://localhost:${worker.port}/cron/${encodeURIComponent(cronName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: resolvedConfig,
          authState: instance.authState ?? null,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cron "${cronName}" failed: HTTP ${response.status} ${text}`);
    }

    const result = (await response.json()) as {
      success: boolean;
      credentialsUpdated?: AuthState;
      error?: string;
    };

    if (!result.success) {
      throw new Error(`Cron "${cronName}" reported failure: ${result.error ?? "unknown error"}`);
    }

    if (result.credentialsUpdated) {
      await pluginInstanceRepository.updateAuthState(instance.id, orgId, result.credentialsUpdated);
      logger.info(
        { pluginId, orgId, cronName },
        "Cron staged credential update — persisting and restarting worker",
      );

      // Restart the worker so the running MCP server picks up the fresh token.
      try {
        await runner.stopWorker(orgId, pluginId);
      } catch (error) {
        logger.warn(
          { err: error, pluginId, orgId },
          "Failed to stop worker after credential update",
        );
      }
      try {
        await runner.startWorker(orgId, pluginId);
      } catch (error) {
        logger.warn(
          { err: error, pluginId, orgId },
          "Failed to restart worker after credential update (will respawn on next use)",
        );
      }
    }
  }
}

// Singleton instance
export const pluginCronService = new PluginCronService();
