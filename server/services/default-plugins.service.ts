/**
 * Default-enabled plugins.
 *
 * A core plugin opts in with `"defaultEnabled": true` in its package.json
 * `hay-plugin` block. New organizations get an enabled instance of every such
 * plugin with an empty config (so schema defaults and env fallbacks apply).
 * Core never names the plugins. An existing instance is left alone, so a
 * plugin an owner disabled is never switched back on. Organizations created
 * before a plugin became default get it from `npm run plugins:enable-defaults`.
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
 * logged and the org simply goes without that plugin. Returns the ids enabled.
 */
export async function enableDefaultPlugins(organizationId: string): Promise<string[]> {
  const enabled: string[] = [];
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
      enabled.push(pluginId);
      logger.info({ organizationId, pluginId }, "Enabled default plugin");
    } catch (error) {
      logger.error({ err: error, organizationId, pluginId }, "Failed to enable default plugin");
    }
  }
  return enabled;
}

/**
 * Backfill for organizations created before a plugin became default-enabled
 * (D2: Turnstile). Same rule as for a new org: only orgs with no instance of
 * the plugin get one, so a plugin an owner disabled stays off.
 */
export async function enableDefaultPluginsForOrganizations(
  organizationIds: string[],
): Promise<{ organizations: number; enabled: Record<string, number> }> {
  const enabled: Record<string, number> = {};
  for (const organizationId of organizationIds) {
    for (const pluginId of await enableDefaultPlugins(organizationId)) {
      enabled[pluginId] = (enabled[pluginId] ?? 0) + 1;
    }
  }
  return { organizations: organizationIds.length, enabled };
}
