/**
 * Remove cloud plugin from registry and all its instances
 */

import { AppDataSource } from "../server/database/data-source";
import { PluginRegistry } from "../server/entities/plugin-registry.entity";
import { PluginInstance } from "../server/entities/plugin-instance.entity";

async function removeCloudPlugin() {
  try {
    // Initialize database connection
    await AppDataSource.initialize();
    console.log("✅ Database connected");

    const pluginRegistry = AppDataSource.getRepository(PluginRegistry);
    const pluginInstance = AppDataSource.getRepository(PluginInstance);

    // First, find the plugin registry entry
    const plugin = await pluginRegistry.findOne({
      where: { pluginId: "cloud" },
    });

    if (!plugin) {
      console.log("ℹ️  Plugin not found in registry (already removed or never registered)");
      await AppDataSource.destroy();
      return;
    }

    console.log(`📦 Found plugin: ${plugin.name} (ID: ${plugin.id})`);

    // Delete all plugin instances first
    const instancesResult = await pluginInstance.delete({
      pluginId: plugin.id,
    });

    if (instancesResult.affected && instancesResult.affected > 0) {
      console.log(`✅ Removed ${instancesResult.affected} plugin instance(s)`);
    } else {
      console.log("ℹ️  No plugin instances to remove");
    }

    // Now delete the plugin registry entry
    const result = await pluginRegistry.delete({
      id: plugin.id,
    });

    if (result.affected && result.affected > 0) {
      console.log(`✅ Removed cloud plugin from registry`);
    }

    await AppDataSource.destroy();
    console.log("✅ Done");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

removeCloudPlugin();
