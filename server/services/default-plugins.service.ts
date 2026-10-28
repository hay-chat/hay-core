/**
 * Default-enabled plugins.
 *
 * A core plugin opts in with `"defaultEnabled": true` in its package.json
 * `hay-plugin` block. New organizations get an enabled instance of every such
 * plugin with an empty config (so schema defaults and env fallbacks apply).
 * Core never names the plugins. An existing instance is left alone, so a
 * plugin an owner disabled is never switched back on.
 */

import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("default-plugins");

/** Ids of registered core plugins that declare `defaultEnabled`. */
export function defaultEnabledPluginIds(): string[] {
  return pluginManagerService
    .getAllPlugins()
    .filter((plugin) => plugin.sourceType === "core" && plugin.manifest?.defaultEnabled === true)
    .map((plugin) => plugin.pluginId);
}

/**
 * Enable every default plugin for an organization. Never throws: a failure is
 * logged and the org simply starts without that plugin.
 */
export async function enableDefaultPlugins(organizationId: string): Promise<void> {
  for (const pluginId of defaultEnabledPluginIds()) {
    try {
      const existing = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (existing) continue;

      if (pluginManagerService.needsInstallation(pluginId)) {
        await pluginManagerService.installPlugin(pluginId);
      }
      if (pluginManagerService.needsBuilding(pluginId)) {
        await pluginManagerService.buildPlugin(pluginId);
      }
      await pluginInstanceRepository.enablePlugin(organizationId, pluginId, {});
      logger.info({ organizationId, pluginId }, "Enabled default plugin for new organization");
    } catch (error) {
      logger.error({ err: error, organizationId, pluginId }, "Failed to enable default plugin");
    }
  }
}
