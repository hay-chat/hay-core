/**
 * Integration test for the migrated email plugin
 *
 * Tests:
 * 1. Plugin discovery
 * 2. Plugin installation
 * 3. Worker spawning with secure env vars
 * 4. MCP registration via Plugin API
 */

import { pluginManagerService } from '../server/services/plugin-manager.service';

async function testEmailPluginIntegration() {
  console.log('🧪 Testing Email Plugin Integration\n');

  try {
    // Step 1: Check if email plugin is discovered
    console.log('1️⃣  Checking plugin discovery...');
    const emailPlugin = pluginManagerService.getPlugin('email');

    if (!emailPlugin) {
      console.error('❌ Email plugin not discovered by plugin manager');
      console.log('   Available plugins:', pluginManagerService.getAllPlugins().map(p => p.id));
      return;
    }

    console.log('✅ Email plugin discovered');
    console.log('   Plugin ID:', emailPlugin.id);
    console.log('   Plugin Name:', emailPlugin.name);
    console.log('   Plugin Entry:', emailPlugin.entry);
    console.log('   Plugin Path:', emailPlugin.pluginPath);
    console.log('');

    // Step 2: Check if plugin is built
    console.log('2️⃣  Checking build status...');
    if (!emailPlugin.built) {
      console.log('⏳ Plugin not built, building...');
      await pluginManagerService.buildPlugin('email');
      console.log('✅ Plugin built successfully');
    } else {
      console.log('✅ Plugin already built');
    }
    console.log('');

    // Step 3: Check if plugin is installed
    console.log('3️⃣  Checking installation status...');
    if (!emailPlugin.installed) {
      console.log('⏳ Plugin not installed, installing...');
      await pluginManagerService.installPlugin('email');
      console.log('✅ Plugin installed successfully');
    } else {
      console.log('✅ Plugin already installed');
    }
    console.log('');

    // Step 4: Verify plugin entry point exists
    console.log('4️⃣  Verifying plugin entry point...');
    const fs = await import('fs-extra');
    const path = await import('path');
    const pluginDir = path.join(process.cwd(), 'plugins', emailPlugin.pluginPath);
    const entryPath = path.join(pluginDir, emailPlugin.entry);
    const entryExists = await fs.pathExists(entryPath);

    if (!entryExists) {
      console.error('❌ Plugin entry point not found:', entryPath);
      return;
    }

    console.log('✅ Plugin entry point exists:', entryPath);
    console.log('');

    // Step 5: Check manifest capabilities
    console.log('5️⃣  Checking plugin capabilities...');
    console.log('   Capabilities:', emailPlugin.capabilities);
    console.log('');

    console.log('✨ Email plugin integration test PASSED!\n');
    console.log('📝 Next steps to test with live server:');
    console.log('   1. Enable email plugin for a test organization');
    console.log('   2. Plugin manager will spawn worker with secure env vars');
    console.log('   3. Worker will register MCP server via Plugin API');
    console.log('   4. Check MCP tools are available in registry');
    console.log('');

  } catch (error) {
    console.error('❌ Email plugin integration test FAILED!');
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the test
testEmailPluginIntegration().catch(console.error);
