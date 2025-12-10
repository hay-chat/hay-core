/**
 * Script to clean up and re-register all plugins in the database
 *
 * This script:
 * 1. Deletes all core plugins from the database
 * 2. Re-discovers and registers all plugins from the filesystem
 * 3. Ensures plugin IDs and display names are correct
 *
 * Run with: npx ts-node scripts/cleanup-plugin-registry.ts
 */

import { AppDataSource } from '../server/database/data-source';
import { PluginRegistry } from '../server/entities/plugin-registry.entity';
import { pluginManagerService } from '../server/services/plugin-manager.service';

async function cleanup() {
  try {
    console.log('🔧 Initializing database connection...');
    await AppDataSource.initialize();

    const pluginRegistryRepo = AppDataSource.getRepository(PluginRegistry);

    console.log('\n📊 Current plugin registry:');
    const allPlugins = await pluginRegistryRepo.find({
      order: { pluginId: 'ASC' }
    });

    console.log(`Found ${allPlugins.length} plugins in database:`);
    for (const plugin of allPlugins) {
      console.log(`  - ${plugin.pluginId} | name: "${plugin.name}" | sourceType: ${plugin.sourceType}`);
    }

    // First, delete all plugin instances for core plugins
    console.log('\n🗑️  Deleting plugin instances for core plugins...');
    const instancesResult = await AppDataSource.query(`
      DELETE FROM plugin_instances
      WHERE plugin_id IN (
        SELECT id FROM plugin_registry WHERE source_type = 'core'
      )
    `);
    console.log(`Deleted plugin instances`);

    // Now delete core plugins
    console.log('🗑️  Deleting core plugins from database...');
    const deleteResult = await pluginRegistryRepo.delete({ sourceType: 'core' });
    console.log(`Deleted ${deleteResult.affected || 0} core plugin entries`);

    // Re-discover and register all plugins
    console.log('\n🔍 Re-discovering plugins from filesystem...');

    // Clear the in-memory registry
    pluginManagerService.registry.clear();

    // Re-initialize plugin manager (discovers and registers plugins)
    await pluginManagerService.initialize();

    // Show final state
    console.log('\n✅ Updated plugin registry:');
    const updatedPlugins = await pluginRegistryRepo.find({
      where: { sourceType: 'core' },
      order: { pluginId: 'ASC' }
    });

    console.log(`Found ${updatedPlugins.length} core plugins:`);
    for (const plugin of updatedPlugins) {
      console.log(`  ✓ ${plugin.pluginId} | name: "${plugin.name}" | version: ${plugin.version}`);
    }

    console.log('\n🎉 Cleanup completed successfully!');
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }
}

cleanup();
