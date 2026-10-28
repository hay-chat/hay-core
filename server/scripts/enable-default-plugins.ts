#!/usr/bin/env node
/**
 * D2: give existing organizations the default-enabled core plugins (those
 * whose package.json declares `"defaultEnabled": true`, e.g. bot protection)
 * that new organizations get at sign-up. Plugins are discovered from disk the
 * way the server does at start, so no plugin id is named here. Only orgs with
 * no instance of a plugin get one: a plugin an owner disabled stays off.
 * Safe to run again.
 *
 *   npm run plugins:enable-defaults                 # every organization
 *   npm run plugins:enable-defaults -- <org-uuid>   # one organization
 */
import { AppDataSource } from "../database/data-source";

async function main() {
  const organizationId = process.argv[2];
  await AppDataSource.initialize();
  const { pluginManagerService } = await import("../services/plugin-manager.service");
  const { defaultEnabledPluginIds, enableDefaultPluginsForOrganizations } =
    await import("../services/default-plugins.service");

  await pluginManagerService.initialize();
  const pluginIds = defaultEnabledPluginIds();
  console.log(`Default-enabled plugins: ${pluginIds.join(", ") || "(none)"}`);

  const rows: Array<{ id: string }> = organizationId
    ? await AppDataSource.query(`SELECT id FROM organizations WHERE id = $1`, [organizationId])
    : await AppDataSource.query(`SELECT id FROM organizations ORDER BY created_at ASC`);
  const { organizations, enabled } = await enableDefaultPluginsForOrganizations(
    rows.map((row) => row.id),
  );
  console.log(`Checked ${organizations} organizations.`);
  for (const pluginId of pluginIds) {
    console.log(`  ${pluginId}: enabled for ${enabled[pluginId] ?? 0}`);
  }
  await AppDataSource.destroy();
}

main().catch((error) => {
  console.error("Enabling default plugins failed:", error);
  process.exit(1);
});
