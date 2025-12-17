/**
 * Phase 6 Test: Email Plugin with SDK v2 Runner
 *
 * This test demonstrates the full MCP integration flow:
 * 1. Start a plugin worker using SDK v2 runner
 * 2. Plugin registers MCP server in onStart hook
 * 3. Core fetches tools from /mcp/list-tools
 * 4. Core calls a tool via /mcp/call-tool
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';

interface TestResult {
  step: string;
  success: boolean;
  data?: any;
  error?: string;
}

const results: TestResult[] = [];

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || '');
}

function addResult(step: string, success: boolean, data?: any, error?: string) {
  results.push({ step, success, data, error });
  if (success) {
    log(`✅ ${step}`, data);
  } else {
    log(`❌ ${step}`, error);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForEndpoint(port: number, endpoint: string, maxAttempts: number = 20): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}${endpoint}`, {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        log(`Endpoint ready: ${endpoint} (attempt ${attempt})`);
        return true;
      }
    } catch (err) {
      // Ignore, will retry
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  log('🚀 Starting Phase 6 MCP Integration Test');

  let workerProcess: ChildProcess | null = null;
  const testPort = 5555;

  try {
    // Step 1: Create a test plugin directory
    log('Step 1: Using SDK v2 example stripe plugin...');
    const pluginPath = path.join(__dirname, 'plugin-sdk-v2/examples/stripe');
    addResult('Plugin path resolved', true, { pluginPath });

    // Step 2: Start worker with SDK v2 runner
    log('Step 2: Starting plugin worker...');
    const runnerPath = path.join(__dirname, 'plugin-sdk-v2/runner/index.ts');

    workerProcess = spawn('npx', [
      'tsx',
      runnerPath,
      `--plugin-path=${pluginPath}`,
      '--org-id=test-org-phase6',
      `--port=${testPort}`,
      '--mode=test'
    ], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      }
    });

    // Log worker output
    workerProcess.stdout?.on('data', (data) => {
      log(`[Worker STDOUT] ${data.toString().trim()}`);
    });

    workerProcess.stderr?.on('data', (data) => {
      log(`[Worker STDERR] ${data.toString().trim()}`);
    });

    workerProcess.on('exit', (code, signal) => {
      log(`Worker process exited: code=${code}, signal=${signal}`);
    });

    addResult('Worker process spawned', true, { pid: workerProcess.pid, port: testPort });

    // Step 3: Wait for /metadata endpoint
    log('Step 3: Waiting for /metadata endpoint...');
    const metadataReady = await waitForEndpoint(testPort, '/metadata');
    if (!metadataReady) {
      throw new Error('/metadata endpoint did not become available');
    }
    addResult('Metadata endpoint ready', true);

    // Step 4: Fetch metadata
    log('Step 4: Fetching plugin metadata...');
    const metadataResponse = await fetch(`http://localhost:${testPort}/metadata`);
    const metadata = await metadataResponse.json();
    addResult('Metadata fetched', true, {
      configFields: Object.keys(metadata.configSchema || {}).length,
      authMethods: metadata.authMethods?.length || 0,
      routes: metadata.routes?.length || 0,
    });

    // Step 5: List MCP tools
    log('Step 5: Listing MCP tools via /mcp/list-tools...');
    await sleep(2000); // Give MCP server time to start in onStart hook

    const listToolsResponse = await fetch(`http://localhost:${testPort}/mcp/list-tools`);
    if (!listToolsResponse.ok) {
      throw new Error(`/mcp/list-tools failed: HTTP ${listToolsResponse.status}`);
    }
    const toolsList = await listToolsResponse.json();
    addResult('MCP tools listed', true, {
      toolCount: toolsList.tools?.length || 0,
      tools: toolsList.tools?.map((t: any) => t.name) || []
    });

    // Step 6: Call an MCP tool
    if (toolsList.tools && toolsList.tools.length > 0) {
      const firstTool = toolsList.tools[0];
      log(`Step 6: Calling MCP tool "${firstTool.name}"...`);

      const callToolResponse = await fetch(`http://localhost:${testPort}/mcp/call-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: firstTool.name,
          arguments: {} // Empty args for demo tools
        })
      });

      if (!callToolResponse.ok) {
        const errorText = await callToolResponse.text();
        throw new Error(`/mcp/call-tool failed: HTTP ${callToolResponse.status} - ${errorText}`);
      }

      const toolResult = await callToolResponse.json();
      addResult('MCP tool called successfully', true, {
        toolName: firstTool.name,
        result: toolResult
      });
    } else {
      addResult('MCP tool call skipped', false, undefined, 'No tools available');
    }

    // Success!
    log('✅ All tests passed!');

  } catch (error: any) {
    addResult('Test failed', false, undefined, error.message);
    console.error('❌ Test failed:', error);
  } finally {
    // Cleanup: Stop worker
    if (workerProcess) {
      log('Stopping worker process...');
      workerProcess.kill('SIGTERM');
      await sleep(1000);
      if (!workerProcess.killed) {
        workerProcess.kill('SIGKILL');
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    results.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      console.log(`${index + 1}. ${status} ${result.step}`);
      if (result.data) {
        console.log(`   Data:`, JSON.stringify(result.data, null, 2));
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    const passed = results.filter(r => r.success).length;
    const total = results.length;
    console.log(`\nResults: ${passed}/${total} steps passed`);
    console.log('='.repeat(80) + '\n');

    process.exit(passed === total ? 0 : 1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
