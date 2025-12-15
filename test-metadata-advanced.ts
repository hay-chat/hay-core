/**
 * Advanced Test Suite for Phase 3: Metadata Ingestion
 *
 * Tests high-priority scenarios:
 * 1. Database persistence
 * 2. Metadata state transitions
 * 3. Error handling and degraded mode
 * 4. Retry logic verification
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { createServer, Server } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic imports for database access
let AppDataSource: any;
let pluginRegistryRepository: any;

const PLUGIN_PATH = path.join(__dirname, "plugin-sdk-v2/examples/stripe");
const RUNNER_PATH = path.join(__dirname, "plugin-sdk-v2/dist/runner/index.js");
const ORG_ID = "test-org-advanced";
const BASE_PORT = 5600;

let workerProcess: ChildProcess | null = null;
let mockServer: Server | null = null;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initDatabase() {
  console.log("📦 Initializing database connection...");

  try {
    const dataSourceModule = await import("./server/database/data-source.js");
    AppDataSource = dataSourceModule.AppDataSource;

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log("✅ Database connected\n");
    }

    const repoModule = await import("./server/repositories/plugin-registry.repository.js");
    pluginRegistryRepository = repoModule.pluginRegistryRepository;
  } catch (error) {
    console.error("❌ Failed to initialize database:", error);
    throw error;
  }
}

async function cleanupDatabase() {
  if (AppDataSource?.isInitialized) {
    await AppDataSource.destroy();
    console.log("✅ Database connection closed");
  }
}

async function startWorker(port: number, mode: string = "test"): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const worker = spawn(
      "node",
      [
        RUNNER_PATH,
        `--plugin-path=${PLUGIN_PATH}`,
        `--org-id=${ORG_ID}`,
        `--port=${port}`,
        `--mode=${mode}`,
      ],
      {
        env: {
          ...process.env,
          HAY_ORG_ID: ORG_ID,
          HAY_WORKER_PORT: port.toString(),
          HAY_ORG_CONFIG: JSON.stringify({}),
          HAY_ORG_AUTH: JSON.stringify({}),
          NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    worker.stdout?.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg.includes("Worker started")) {
        resolve(worker);
      }
    });

    worker.stderr?.on("data", (data) => {
      console.error(`[Worker Error] ${data.toString().trim()}`);
    });

    worker.on("error", reject);

    // Timeout fallback
    setTimeout(() => resolve(worker), 2000);
  });
}

function stopWorker(worker: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!worker || worker.killed) {
      resolve();
      return;
    }

    worker.on("exit", () => resolve());
    worker.kill("SIGTERM");

    setTimeout(() => {
      if (!worker.killed) {
        worker.kill("SIGKILL");
      }
      resolve();
    }, 2000);
  });
}

async function waitForEndpoint(port: number, maxAttempts: number = 20): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}/metadata`, {
        signal: AbortSignal.timeout(1000),
      });

      if (response.ok) {
        return true;
      }
    } catch (error) {
      // Ignore
    }

    await sleep(500);
  }

  return false;
}

// ============================================================================
// Test 1: Database Persistence
// ============================================================================

async function testDatabasePersistence(): Promise<boolean> {
  console.log("\n" + "=".repeat(80));
  console.log("TEST 1: Database Persistence");
  console.log("=".repeat(80) + "\n");

  const port = BASE_PORT;
  const pluginId = "hay-plugin-stripe";

  try {
    // Start worker
    console.log("🚀 Starting worker...");
    workerProcess = await startWorker(port);

    // Wait for metadata endpoint
    console.log("⏳ Waiting for /metadata endpoint...");
    const ready = await waitForEndpoint(port);
    if (!ready) {
      throw new Error("Worker failed to start");
    }
    console.log("✅ Worker ready\n");

    // Import metadata service
    const { fetchMetadataFromWorker } = await import("./server/services/plugin-metadata.service.js");

    // Fetch metadata
    console.log("📥 Fetching metadata...");
    const metadata = await fetchMetadataFromWorker(port, pluginId);
    console.log("✅ Metadata fetched\n");

    // Ensure plugin exists in database first
    console.log("🔍 Checking if plugin exists in database...");
    let plugin = await pluginRegistryRepository.findByPluginId(pluginId);

    if (!plugin) {
      console.log("   Plugin not found, creating entry...");
      plugin = await pluginRegistryRepository.upsertPlugin({
        pluginId,
        name: "Stripe (Test)",
        version: "0.1.0",
        pluginPath: "plugin-sdk-v2/examples/stripe",
        manifest: {} as any,
        checksum: "test-checksum",
        sourceType: "core",
        organizationId: undefined,
      });
      console.log("   ✓ Plugin entry created");
    } else {
      console.log("   ✓ Plugin found");
    }
    console.log();

    // Store in database
    console.log("💾 Storing metadata in database...");
    await pluginRegistryRepository.updateMetadata(pluginId, {
      metadata,
      metadataFetchedAt: new Date(),
      metadataState: "fresh",
    });
    console.log("✅ Metadata stored\n");

    // Verify database persistence
    console.log("🔍 Verifying database persistence...");
    plugin = await pluginRegistryRepository.findByPluginId(pluginId);

    if (!plugin) {
      throw new Error("Plugin not found in database");
    }

    if (!plugin.metadata) {
      throw new Error("Metadata not persisted to database");
    }

    if (plugin.metadataState !== "fresh") {
      throw new Error(`Expected metadataState='fresh', got '${plugin.metadataState}'`);
    }

    if (!plugin.metadataFetchedAt) {
      throw new Error("metadataFetchedAt not set");
    }

    console.log("✅ Database persistence verified:");
    console.log(`   - metadata: ${Object.keys(plugin.metadata).length} fields`);
    console.log(`   - metadataState: ${plugin.metadataState}`);
    console.log(`   - metadataFetchedAt: ${plugin.metadataFetchedAt.toISOString()}`);

    return true;
  } catch (error) {
    console.error("❌ Test failed:", error);
    return false;
  } finally {
    if (workerProcess) {
      await stopWorker(workerProcess);
      workerProcess = null;
    }
  }
}

// ============================================================================
// Test 2: Metadata State Transitions
// ============================================================================

async function testStateTransitions(): Promise<boolean> {
  console.log("\n" + "=".repeat(80));
  console.log("TEST 2: Metadata State Transitions");
  console.log("=".repeat(80) + "\n");

  const pluginId = "hay-plugin-stripe";

  try {
    // Test 2.1: missing → fresh
    console.log("📝 Test 2.1: missing → fresh transition");

    await pluginRegistryRepository.updateMetadataState(
      (await pluginRegistryRepository.findByPluginId(pluginId)).id,
      "missing"
    );

    let plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (plugin.metadataState !== "missing") {
      throw new Error("Failed to set state to 'missing'");
    }
    console.log("   ✓ State set to 'missing'");

    await pluginRegistryRepository.updateMetadataState(plugin.id, "fresh");
    plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (plugin.metadataState !== "fresh") {
      throw new Error("Failed to transition to 'fresh'");
    }
    console.log("   ✓ Transitioned to 'fresh'\n");

    // Test 2.2: fresh → stale
    console.log("📝 Test 2.2: fresh → stale transition");

    await pluginRegistryRepository.updateMetadataState(plugin.id, "stale");
    plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (plugin.metadataState !== "stale") {
      throw new Error("Failed to transition to 'stale'");
    }
    console.log("   ✓ Transitioned to 'stale'\n");

    // Test 2.3: stale → fresh (recovery)
    console.log("📝 Test 2.3: stale → fresh transition (recovery)");

    await pluginRegistryRepository.updateMetadataState(plugin.id, "fresh");
    plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (plugin.metadataState !== "fresh") {
      throw new Error("Failed to recover to 'fresh'");
    }
    console.log("   ✓ Recovered to 'fresh'\n");

    // Test 2.4: fresh → error
    console.log("📝 Test 2.4: fresh → error transition");

    await pluginRegistryRepository.updateMetadataState(plugin.id, "error");
    plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (plugin.metadataState !== "error") {
      throw new Error("Failed to transition to 'error'");
    }
    console.log("   ✓ Transitioned to 'error'\n");

    // Test 2.5: error → fresh (recovery)
    console.log("📝 Test 2.5: error → fresh transition (recovery)");

    await pluginRegistryRepository.updateMetadataState(plugin.id, "fresh");
    plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (plugin.metadataState !== "fresh") {
      throw new Error("Failed to recover from error to 'fresh'");
    }
    console.log("   ✓ Recovered from error to 'fresh'\n");

    console.log("✅ All state transitions working correctly");
    return true;
  } catch (error) {
    console.error("❌ Test failed:", error);
    return false;
  }
}

// ============================================================================
// Test 3: Error Handling
// ============================================================================

async function testErrorHandling(): Promise<boolean> {
  console.log("\n" + "=".repeat(80));
  console.log("TEST 3: Error Handling");
  console.log("=".repeat(80) + "\n");

  const port = BASE_PORT + 1;
  const pluginId = "hay-plugin-stripe";

  try {
    // Test 3.1: Timeout handling
    console.log("📝 Test 3.1: Timeout handling");

    // Create a mock server that delays response beyond timeout
    mockServer = createServer((req, res) => {
      // Never respond - force timeout
      setTimeout(() => {
        res.writeHead(200);
        res.end(JSON.stringify({ configSchema: {} }));
      }, 10000); // 10s delay, but timeout is 5s
    });

    await new Promise((resolve) => {
      mockServer!.listen(port, () => resolve(undefined));
    });

    console.log(`   Mock server listening on port ${port}`);

    const { fetchMetadataFromWorker } = await import("./server/services/plugin-metadata.service.js");

    let errorCaught = false;
    try {
      await fetchMetadataFromWorker(port, pluginId);
    } catch (error) {
      errorCaught = true;
      console.log(`   ✓ Timeout error caught: ${error instanceof Error ? error.message : error}`);
    }

    if (!errorCaught) {
      throw new Error("Expected timeout error but none was thrown");
    }

    mockServer.close();
    mockServer = null;
    console.log();

    // Test 3.2: HTTP error handling
    console.log("📝 Test 3.2: HTTP error handling (500)");

    mockServer = createServer((req, res) => {
      res.writeHead(500);
      res.end("Internal Server Error");
    });

    await new Promise((resolve) => {
      mockServer!.listen(port, () => resolve(undefined));
    });

    errorCaught = false;
    try {
      await fetchMetadataFromWorker(port, pluginId);
    } catch (error) {
      errorCaught = true;
      console.log(`   ✓ HTTP 500 error caught: ${error instanceof Error ? error.message : error}`);
    }

    if (!errorCaught) {
      throw new Error("Expected HTTP error but none was thrown");
    }

    mockServer.close();
    mockServer = null;
    console.log();

    // Test 3.3: Malformed JSON handling
    console.log("📝 Test 3.3: Malformed JSON handling");

    mockServer = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{ invalid json");
    });

    await new Promise((resolve) => {
      mockServer!.listen(port, () => resolve(undefined));
    });

    errorCaught = false;
    try {
      await fetchMetadataFromWorker(port, pluginId);
    } catch (error) {
      errorCaught = true;
      console.log(`   ✓ JSON parse error caught: ${error instanceof Error ? error.message : error}`);
    }

    if (!errorCaught) {
      throw new Error("Expected JSON parse error but none was thrown");
    }

    mockServer.close();
    mockServer = null;
    console.log();

    // Test 3.4: Invalid metadata structure
    console.log("📝 Test 3.4: Invalid metadata structure");

    mockServer = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        configSchema: "invalid", // Should be object
        authMethods: [],
        uiExtensions: [],
        routes: [],
        mcp: { local: [], external: [] }
      }));
    });

    await new Promise((resolve) => {
      mockServer!.listen(port, () => resolve(undefined));
    });

    errorCaught = false;
    try {
      await fetchMetadataFromWorker(port, pluginId);
    } catch (error) {
      errorCaught = true;
      console.log(`   ✓ Validation error caught: ${error instanceof Error ? error.message : error}`);
    }

    if (!errorCaught) {
      throw new Error("Expected validation error but none was thrown");
    }

    mockServer.close();
    mockServer = null;
    console.log();

    console.log("✅ All error handling scenarios working correctly");
    return true;
  } catch (error) {
    console.error("❌ Test failed:", error);
    return false;
  } finally {
    if (mockServer) {
      mockServer.close();
      mockServer = null;
    }
  }
}

// ============================================================================
// Test 4: Retry Logic
// ============================================================================

async function testRetryLogic(): Promise<boolean> {
  console.log("\n" + "=".repeat(80));
  console.log("TEST 4: Retry Logic Verification");
  console.log("=".repeat(80) + "\n");

  const port = BASE_PORT + 2;
  const pluginId = "hay-plugin-stripe";

  try {
    console.log("📝 Creating mock server that fails twice, succeeds on third attempt");

    let attemptCount = 0;
    const metadata = {
      configSchema: { test: { type: "string", label: "Test" } },
      authMethods: [],
      uiExtensions: [],
      routes: [],
      mcp: { local: [], external: [] }
    };

    mockServer = createServer((req, res) => {
      attemptCount++;
      console.log(`   Attempt ${attemptCount} received`);

      if (attemptCount < 3) {
        // Fail first 2 attempts
        res.writeHead(500);
        res.end("Temporary error");
      } else {
        // Succeed on 3rd attempt
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(metadata));
      }
    });

    await new Promise((resolve) => {
      mockServer!.listen(port, () => resolve(undefined));
    });

    const { fetchMetadataFromWorker } = await import("./server/services/plugin-metadata.service.js");

    console.log("📥 Fetching metadata (should retry 3 times)...\n");
    const startTime = Date.now();

    const result = await fetchMetadataFromWorker(port, pluginId);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log();
    console.log(`✅ Metadata fetched after ${attemptCount} attempts`);
    console.log(`   Duration: ${duration}ms`);

    if (attemptCount !== 3) {
      throw new Error(`Expected 3 attempts, got ${attemptCount}`);
    }

    // Verify backoff timing (should be ~3 seconds total: 1s + 2s)
    if (duration < 2000 || duration > 5000) {
      console.warn(`   ⚠️  Duration unexpected: ${duration}ms (expected ~3000ms with backoff)`);
    } else {
      console.log(`   ✓ Exponential backoff timing correct`);
    }

    mockServer.close();
    mockServer = null;

    console.log("\n✅ Retry logic working correctly");
    return true;
  } catch (error) {
    console.error("❌ Test failed:", error);
    return false;
  } finally {
    if (mockServer) {
      mockServer.close();
      mockServer = null;
    }
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main() {
  console.log("🧪 Advanced Test Suite for Phase 3: Metadata Ingestion\n");

  const results = {
    databasePersistence: false,
    stateTransitions: false,
    errorHandling: false,
    retryLogic: false,
  };

  try {
    // Initialize database
    await initDatabase();

    // Run tests
    results.databasePersistence = await testDatabasePersistence();
    await sleep(1000);

    results.stateTransitions = await testStateTransitions();
    await sleep(1000);

    results.errorHandling = await testErrorHandling();
    await sleep(1000);

    results.retryLogic = await testRetryLogic();

    // Summary
    console.log("\n" + "=".repeat(80));
    console.log("TEST SUMMARY");
    console.log("=".repeat(80) + "\n");

    console.log("Test Results:");
    console.log(`  ${results.databasePersistence ? "✅" : "❌"} Database Persistence`);
    console.log(`  ${results.stateTransitions ? "✅" : "❌"} State Transitions`);
    console.log(`  ${results.errorHandling ? "✅" : "❌"} Error Handling`);
    console.log(`  ${results.retryLogic ? "✅" : "❌"} Retry Logic`);

    const allPassed = Object.values(results).every((r) => r === true);
    const passedCount = Object.values(results).filter((r) => r === true).length;
    const totalCount = Object.values(results).length;

    console.log();
    console.log(`Overall: ${passedCount}/${totalCount} tests passed`);

    if (allPassed) {
      console.log("\n✅ All high-priority tests passed!\n");
      process.exit(0);
    } else {
      console.log("\n❌ Some tests failed. Review output above.\n");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n💥 Fatal error:", error);
    process.exit(1);
  } finally {
    await cleanupDatabase();
  }
}

// Run tests
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
