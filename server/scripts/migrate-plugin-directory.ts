import * as fs from "fs";
import * as path from "path";
import { AppDataSource } from "@server/database/data-source";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { PluginRegistry } from "@server/entities/plugin-registry.entity";

/**
 * Migration script to restructure plugin directory
 * Moves existing plugins from plugins/{name} to plugins/core/{name}
 * Creates plugins/custom/ directory for organization-specific uploads
 * Updates database records to reflect new structure
 */
async function migratePluginDirectory() {
  try {
    console.log("🚀 Starting plugin directory migration...\n");

    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log("✅ Database connection established\n");
    }

    const pluginsRoot = path.join(process.cwd(), "..", "plugins");
    const coreDir = path.join(pluginsRoot, "core");
    const customDir = path.join(pluginsRoot, "custom");

    // 1. Create core directory
    if (!fs.existsSync(coreDir)) {
      fs.mkdirSync(coreDir, { recursive: true });
      console.log("✅ Created plugins/core directory");
    } else {
      console.log("ℹ️  plugins/core directory already exists");
    }

    // 2. Move existing plugins to core
    const entries = await fs.promises.readdir(pluginsRoot, { withFileTypes: true });
    let movedCount = 0;
    const movedPlugins: string[] = [];

    console.log("\n📦 Moving plugins to core/...");
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        entry.name !== "base" &&
        entry.name !== "core" &&
        entry.name !== "custom" &&
        !entry.name.startsWith(".")
      ) {
        const oldPath = path.join(pluginsRoot, entry.name);
        const newPath = path.join(coreDir, entry.name);

        // Check if target already exists
        if (fs.existsSync(newPath)) {
          console.log(`⚠️  Skipping ${entry.name} (already exists in core/)`);
          movedPlugins.push(entry.name);
          continue;
        }

        await fs.promises.rename(oldPath, newPath);
        console.log(`   ✓ Moved ${entry.name} → core/${entry.name}`);
        movedPlugins.push(entry.name);
        movedCount++;
      }
    }

    console.log(`\n✅ Moved ${movedCount} plugins to core/`);

    // 3. Create custom directory
    if (!fs.existsSync(customDir)) {
      fs.mkdirSync(customDir, { recursive: true });
      console.log("✅ Created plugins/custom directory");
    } else {
      console.log("ℹ️  plugins/custom directory already exists");
    }

    // 4. Update database pluginPath values
    console.log("\n💾 Updating database records...");
    const allPlugins = await pluginRegistryRepository.getAllPlugins();
    let updatedCount = 0;
    let alreadyUpdatedCount = 0;

    // Get list of plugins that exist in core/ directory
    const corePlugins: string[] = [];
    if (fs.existsSync(coreDir)) {
      const coreEntries = await fs.promises.readdir(coreDir, { withFileTypes: true });
      for (const entry of coreEntries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          corePlugins.push(entry.name);
        }
      }
    }

    for (const plugin of allPlugins) {
      // Skip if already migrated
      if (plugin.pluginPath.startsWith("core/") || plugin.pluginPath.startsWith("custom/")) {
        alreadyUpdatedCount++;
        continue;
      }

      // Update if this plugin exists in core/ directory
      if (corePlugins.includes(plugin.pluginPath)) {
        const newPath = `core/${plugin.pluginPath}`;

        // Use AppDataSource directly to avoid protected method issue
        await AppDataSource.getRepository(PluginRegistry).update(plugin.id, {
          pluginPath: newPath,
          sourceType: "core" as const,
          organizationId: undefined,
        } as any);

        console.log(`   ✓ Updated DB: ${plugin.pluginPath} → ${newPath}`);
        updatedCount++;
      } else {
        console.log(`   ⚠️  Plugin ${plugin.pluginPath} not found in core/ directory`);
      }
    }

    console.log(`\n✅ Updated ${updatedCount} database records`);
    if (alreadyUpdatedCount > 0) {
      console.log(`ℹ️  Skipped ${alreadyUpdatedCount} records (already migrated)`);
    }

    console.log("\n🎉 Migration complete!");
    console.log("\n📁 New directory structure:");
    console.log("   /plugins");
    console.log("   ├── base/          (schema and utilities)");
    console.log("   ├── core/          (core plugins)");
    console.log(`   │   └── ${movedPlugins.length} plugins`);
    console.log("   └── custom/        (organization-specific plugins)\n");

    await AppDataSource.destroy();
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

// Run the migration
migratePluginDirectory().catch((error) => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
});
