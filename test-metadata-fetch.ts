/**
 * Test Script for Phase 3: Metadata Ingestion
 *
 * This script tests the metadata fetching functionality by:
 * 1. Starting an SDK v2 plugin worker
 * 2. Fetching metadata from the /metadata endpoint
 * 3. Validating the metadata structure
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PLUGIN_PATH = path.join(__dirname, "plugin-sdk-v2/examples/stripe");
const RUNNER_PATH = path.join(__dirname, "plugin-sdk-v2/dist/runner/index.js");
const ORG_ID = "test-org-123";
const PORT = 5555;
const MODE = "test"; // Use test mode for mock data

let workerProcess: ChildProcess | null = null;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEndpoint(
  port: number,
  maxAttempts: number = 20,
  interval: number = 500
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}/metadata`, {
        signal: AbortSignal.timeout(1000),
      });

      if (response.ok) {
        console.log(`✅ Worker /metadata endpoint ready on port ${port}`);
        return true;
      }
    } catch (error) {
      // Ignore connection errors during startup
    }

    if (attempt < maxAttempts) {
      await sleep(interval);
    }
  }

  return false;
}

async function fetchMetadata(port: number): Promise<any> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 5000);

    try {
      console.log(`🔍 Fetching metadata (attempt ${attempt}/${maxRetries})...`);

      const response = await fetch(`http://localhost:${port}/metadata`, {
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const metadata = await response.json();

      console.log(`✅ Metadata fetched successfully!`);
      return metadata;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error as Error;

      if (error instanceof Error && error.name === "AbortError") {
        console.warn(`⚠️  Timeout on attempt ${attempt}/${maxRetries}`);
      } else {
        console.warn(`⚠️  Failed on attempt ${attempt}/${maxRetries}:`, error);
      }

      if (attempt < maxRetries) {
        await sleep(1000 * attempt); // Exponential backoff
      }
    }
  }

  throw new Error(`Failed to fetch metadata after ${maxRetries} attempts: ${lastError?.message}`);
}

function validateMetadata(metadata: any): void {
  console.log("\n📋 Validating metadata structure...\n");

  // Check top-level structure
  const required = ["configSchema", "authMethods", "uiExtensions", "routes", "mcp"];
  for (const field of required) {
    if (!(field in metadata)) {
      throw new Error(`Missing required field: ${field}`);
    }
    console.log(`  ✓ ${field}: present`);
  }

  // Validate configSchema
  if (typeof metadata.configSchema !== "object") {
    throw new Error("configSchema must be an object");
  }
  console.log(`  ✓ configSchema: ${Object.keys(metadata.configSchema).length} fields`);

  // Validate authMethods
  if (!Array.isArray(metadata.authMethods)) {
    throw new Error("authMethods must be an array");
  }
  console.log(`  ✓ authMethods: ${metadata.authMethods.length} methods`);

  // Validate uiExtensions
  if (!Array.isArray(metadata.uiExtensions)) {
    throw new Error("uiExtensions must be an array");
  }
  console.log(`  ✓ uiExtensions: ${metadata.uiExtensions.length} extensions`);

  // Validate routes
  if (!Array.isArray(metadata.routes)) {
    throw new Error("routes must be an array");
  }
  console.log(`  ✓ routes: ${metadata.routes.length} routes`);

  // Validate MCP
  if (typeof metadata.mcp !== "object") {
    throw new Error("mcp must be an object");
  }
  if (!Array.isArray(metadata.mcp.local)) {
    throw new Error("mcp.local must be an array");
  }
  if (!Array.isArray(metadata.mcp.external)) {
    throw new Error("mcp.external must be an array");
  }
  console.log(
    `  ✓ mcp: ${metadata.mcp.local.length} local, ${metadata.mcp.external.length} external\n`
  );
}

async function main() {
  console.log("🧪 Testing Metadata Fetching (Phase 3)\n");
  console.log("Configuration:");
  console.log(`  Plugin Path: ${PLUGIN_PATH}`);
  console.log(`  Runner Path: ${RUNNER_PATH}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Mode: ${MODE}\n`);

  try {
    // 1. Start SDK v2 worker
    console.log("🚀 Starting SDK v2 plugin worker...\n");

    workerProcess = spawn(
      "node",
      [
        RUNNER_PATH,
        `--plugin-path=${PLUGIN_PATH}`,
        `--org-id=${ORG_ID}`,
        `--port=${PORT}`,
        `--mode=${MODE}`,
      ],
      {
        env: {
          ...process.env,
          HAY_ORG_ID: ORG_ID,
          HAY_WORKER_PORT: PORT.toString(),
          HAY_ORG_CONFIG: JSON.stringify({}),
          HAY_ORG_AUTH: JSON.stringify({}),
          NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // Log stdout
    workerProcess.stdout?.on("data", (data) => {
      console.log(`[Worker] ${data.toString().trim()}`);
    });

    // Log stderr
    workerProcess.stderr?.on("data", (data) => {
      console.error(`[Worker Error] ${data.toString().trim()}`);
    });

    // Handle exit
    workerProcess.on("exit", (code, signal) => {
      console.log(`[Worker] Exited with code ${code}, signal ${signal}`);
    });

    // 2. Wait for worker to be ready
    console.log("⏳ Waiting for worker to start...\n");
    const ready = await waitForEndpoint(PORT);

    if (!ready) {
      throw new Error("Worker failed to start within timeout");
    }

    // 3. Fetch metadata
    const metadata = await fetchMetadata(PORT);

    // 4. Validate metadata
    validateMetadata(metadata);

    // 5. Display metadata
    console.log("📄 Metadata Content:\n");
    console.log(JSON.stringify(metadata, null, 2));

    console.log("\n✅ Test completed successfully!\n");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  } finally {
    // Cleanup
    if (workerProcess) {
      console.log("\n🛑 Stopping worker...");
      workerProcess.kill("SIGTERM");
      await sleep(1000);
      if (!workerProcess.killed) {
        workerProcess.kill("SIGKILL");
      }
    }
  }
}

// Run test
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
