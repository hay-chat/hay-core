/**
 * Test Script for Simple HTTP Plugin Worker
 *
 * This script manually starts the simple-http-test plugin worker to validate:
 * - Worker process spawning
 * - Port allocation
 * - Health check
 * - HTTP route registration
 */

import { pluginManagerService } from "../server/services/plugin-manager.service";

async function testPluginWorker() {
  console.log("🧪 Testing Simple HTTP Plugin Worker...\n");

  try {
    // Use a test organization ID (you'll need to replace with a real one)
    const organizationId = "550e8400-e29b-41d4-a716-446655440000"; // Placeholder UUID
    const pluginId = "simple-http-test";

    console.log(`📦 Starting worker for: ${organizationId}:${pluginId}`);

    // Start the plugin worker
    const worker = await pluginManagerService.startPluginWorker(organizationId, pluginId);

    console.log(`✅ Worker started successfully!`);
    console.log(`   Port: ${worker.port}`);
    console.log(`   Status: ${worker.status}`);
    console.log(`   PID: ${worker.processId}`);

    // Test the health endpoint
    console.log(`\n🏥 Testing health endpoint...`);
    const healthUrl = `http://localhost:${worker.port}/health`;

    const healthResponse = await fetch(healthUrl);
    const healthData = await healthResponse.json();

    console.log(`✅ Health check passed:`, healthData);

    // Test the ping endpoint
    console.log(`\n📡 Testing ping endpoint...`);
    const pingUrl = `http://localhost:${worker.port}/ping`;

    const pingResponse = await fetch(pingUrl);
    const pingData = await pingResponse.json();

    console.log(`✅ Ping check passed:`, pingData);

    // Test the config endpoint
    console.log(`\n⚙️  Testing config endpoint...`);
    const configUrl = `http://localhost:${worker.port}/config`;

    const configResponse = await fetch(configUrl);
    const configData = await configResponse.json();

    console.log(`✅ Config check passed:`, configData);

    console.log(`\n✨ All tests passed! Worker is running correctly.`);
    console.log(`\n⚠️  Worker will continue running. You can stop it via the plugin manager.`);
  } catch (error) {
    console.error(`\n❌ Test failed:`, error);
    process.exit(1);
  }
}

testPluginWorker();
