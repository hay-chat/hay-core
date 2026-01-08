/**
 * Script to clean up plugins that are not found on the filesystem
 *
 * This script:
 * 1. Finds all plugins in the database with status "not_found"
 * 2. Deletes their associated plugin instances first
 * 3. Deletes the plugin registry entries
 *
 * Run with: npx ts-node scripts/cleanup-missing-plugins.ts
 *
 * Options:
 *   --dry-run    Show what would be deleted without actually deleting
 */

import { AppDataSource } from "../server/database/data-source";
import { PluginRegistry, PluginStatus } from "../server/entities/plugin-registry.entity";
import { PluginInstance } from "../server/entities/plugin-instance.entity";

async function cleanupMissingPlugins() {
  const isDryRun = process.argv.includes("--dry-run");

  try {
    console.log("Initializing database connection...");
    await AppDataSource.initialize();

    const pluginRegistryRepo = AppDataSource.getRepository(PluginRegistry);
    const pluginInstanceRepo = AppDataSource.getRepository(PluginInstance);

    // Find all plugins with NOT_FOUND status
    const missingPlugins = await pluginRegistryRepo.find({
      where: { status: PluginStatus.NOT_FOUND },
      order: { pluginId: "ASC" },
    });

    if (missingPlugins.length === 0) {
      console.log("No missing plugins found. Database is clean.");
      return;
    }

    console.log(`\nFound ${missingPlugins.length} missing plugin(s):`);
    for (const plugin of missingPlugins) {
      console.log(`  - ${plugin.pluginId} (${plugin.sourceType}) | path: ${plugin.pluginPath}`);
    }

    if (isDryRun) {
      console.log("\n[DRY RUN] Would delete the above plugins and their instances.");
      console.log("Run without --dry-run to perform actual deletion.");
      return;
    }

    console.log("\nCleaning up...");

    let totalInstancesDeleted = 0;
    let totalPluginsDeleted = 0;

    for (const plugin of missingPlugins) {
      // Delete plugin instances first (foreign key constraint)
      const instancesResult = await pluginInstanceRepo.delete({
        pluginId: plugin.id,
      });

      if (instancesResult.affected && instancesResult.affected > 0) {
        console.log(`  Deleted ${instancesResult.affected} instance(s) for ${plugin.pluginId}`);
        totalInstancesDeleted += instancesResult.affected;
      }

      // Delete the plugin registry entry
      const registryResult = await pluginRegistryRepo.delete({ id: plugin.id });

      if (registryResult.affected && registryResult.affected > 0) {
        console.log(`  Deleted plugin: ${plugin.pluginId}`);
        totalPluginsDeleted += registryResult.affected;
      }
    }

    console.log("\nCleanup completed:");
    console.log(`  - Plugins deleted: ${totalPluginsDeleted}`);
    console.log(`  - Instances deleted: ${totalInstancesDeleted}`);
  } catch (error) {
    console.error("Cleanup failed:", error);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }
}

cleanupMissingPlugins();
