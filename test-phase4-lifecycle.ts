/**
 * Phase 4 Implementation Test - Lifecycle Hooks
 *
 * Tests the Core integration with SDK v2 worker lifecycle endpoints:
 * - POST /validate-auth
 * - POST /disable
 *
 * This script verifies that Hay Core can properly communicate with
 * plugin workers for auth validation and graceful shutdown.
 */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message: string) {
  log(`✅ ${message}`, colors.green);
}

function error(message: string) {
  log(`❌ ${message}`, colors.red);
}

function info(message: string) {
  log(`ℹ️  ${message}`, colors.cyan);
}

function section(title: string) {
  log(`\n${'='.repeat(80)}`, colors.bright);
  log(title, colors.bright);
  log('='.repeat(80), colors.bright);
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  try {
    info(`Running: ${name}`);
    await testFn();
    results.push({ name, passed: true });
    success(name);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: errorMsg });
    error(`${name}: ${errorMsg}`);
  }
}

/**
 * Start SDK v2 worker for testing
 */
async function startWorker(): Promise<{ worker: ChildProcess; port: number }> {
  const port = 5556;
  const pluginPath = path.join(process.cwd(), 'plugin-sdk-v2', 'examples', 'stripe');
  const runnerPath = path.join(process.cwd(), 'plugin-sdk-v2', 'dist', 'runner', 'index.js');

  info(`Starting SDK v2 worker on port ${port}...`);

  const worker = spawn('node', [
    runnerPath,
    `--plugin-path=${pluginPath}`,
    '--org-id=test-org-123',
    `--port=${port}`,
    '--mode=test',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Capture worker logs
  worker.stdout?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      log(`[Worker] ${output}`, colors.yellow);
    }
  });

  worker.stderr?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      log(`[Worker Error] ${output}`, colors.red);
    }
  });

  // Wait for worker to be ready
  await waitForEndpoint(port, '/metadata', 20);

  return { worker, port };
}

/**
 * Wait for endpoint to be ready
 */
async function waitForEndpoint(
  port: number,
  endpoint: string,
  maxAttempts: number = 10
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${port}${endpoint}`);
      if (response.ok) {
        success(`Worker ${endpoint} endpoint ready on port ${port}`);
        return;
      }
    } catch (err) {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Worker ${endpoint} failed to start after ${maxAttempts} attempts`);
}

/**
 * Test 1: POST /validate-auth - Valid Credentials
 */
async function testValidateAuthValid(port: number): Promise<void> {
  const authState = {
    methodId: 'apiKey',
    credentials: {
      apiKey: 'sk_test_valid_key_12345',
    },
  };

  const response = await fetch(`http://localhost:${port}/validate-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authState }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();

  if (!result.valid) {
    throw new Error(`Expected valid=true, got valid=false`);
  }

  info(`  Valid credentials accepted: ${JSON.stringify(result)}`);
}

/**
 * Test 2: POST /validate-auth - Invalid Credentials
 */
async function testValidateAuthInvalid(port: number): Promise<void> {
  const authState = {
    methodId: 'apiKey',
    credentials: {
      apiKey: 'sk_test_invalid',
    },
  };

  const response = await fetch(`http://localhost:${port}/validate-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authState }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();

  if (result.valid) {
    throw new Error(`Expected valid=false for invalid credentials, got valid=true`);
  }

  if (!result.error) {
    throw new Error(`Expected error message for invalid credentials`);
  }

  info(`  Invalid credentials rejected: ${JSON.stringify(result)}`);
}

/**
 * Test 3: POST /validate-auth - Missing Credentials
 */
async function testValidateAuthMissing(port: number): Promise<void> {
  const authState = {
    methodId: 'apiKey',
    credentials: {},
  };

  const response = await fetch(`http://localhost:${port}/validate-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authState }),
  });

  // Should return error response (either 400 or 500 with valid: false)
  const result = await response.json();

  if (result.valid === true) {
    throw new Error(`Expected validation to fail with missing credentials`);
  }

  info(`  Missing credentials handled: ${JSON.stringify(result)}`);
}

/**
 * Test 4: POST /validate-auth - Malformed Request
 */
async function testValidateAuthMalformed(port: number): Promise<void> {
  const response = await fetch(`http://localhost:${port}/validate-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invalidField: 'test' }),
  });

  if (response.status === 200) {
    const result = await response.json();
    if (result.valid === true) {
      throw new Error(`Expected malformed request to fail validation`);
    }
  } else if (response.status !== 400) {
    throw new Error(`Expected 400 or success with valid=false, got ${response.status}`);
  }

  info(`  Malformed request handled properly`);
}

/**
 * Test 5: POST /disable - Graceful Shutdown
 */
async function testDisableHook(port: number): Promise<void> {
  const response = await fetch(`http://localhost:${port}/disable`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(`Expected success=true, got success=false`);
  }

  info(`  Disable hook executed successfully: ${JSON.stringify(result)}`);
}

/**
 * Test 6: Timeout Handling (Core-side simulation)
 */
async function testTimeoutHandling(port: number): Promise<void> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 100); // Very short timeout

  try {
    await fetch(`http://localhost:${port}/validate-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authState: {
          methodId: 'apiKey',
          credentials: { apiKey: 'test' },
        },
      }),
      signal: abortController.signal,
    });

    clearTimeout(timeoutId);
    // If it succeeds within 100ms, that's fine too
    info(`  Request completed within timeout window`);
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as any).name === 'AbortError') {
      // Expected timeout
      info(`  Timeout handling working correctly (AbortError caught)`);
    } else {
      throw err;
    }
  }
}

/**
 * Main test runner
 */
async function main() {
  section('PHASE 4: LIFECYCLE HOOKS TEST');
  info('Testing Core integration with SDK v2 worker lifecycle endpoints');

  let worker: ChildProcess | null = null;
  let port = 0;

  try {
    // Start worker
    section('Setup');
    const workerInfo = await startWorker();
    worker = workerInfo.worker;
    port = workerInfo.port;

    // Run tests
    section('Test Suite: POST /validate-auth');
    await runTest('Valid Credentials', () => testValidateAuthValid(port));
    await runTest('Invalid Credentials', () => testValidateAuthInvalid(port));
    await runTest('Missing Credentials', () => testValidateAuthMissing(port));
    await runTest('Malformed Request', () => testValidateAuthMalformed(port));

    section('Test Suite: POST /disable');
    await runTest('Graceful Shutdown Hook', () => testDisableHook(port));

    section('Test Suite: Error Handling');
    await runTest('Timeout Handling (AbortController)', () => testTimeoutHandling(port));

  } catch (err) {
    error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Cleanup
    if (worker) {
      section('Cleanup');
      info('Stopping worker...');
      worker.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!worker.killed) {
        worker.kill('SIGKILL');
      }
      success('Worker stopped');
    }

    // Print summary
    section('TEST SUMMARY');
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    log('\nTest Results:', colors.bright);
    results.forEach((result) => {
      if (result.passed) {
        success(result.name);
      } else {
        error(`${result.name}: ${result.error || 'Unknown error'}`);
      }
    });

    log(`\nOverall: ${passed}/${results.length} tests passed`, colors.bright);

    if (failed === 0) {
      success('\n✅ All tests passed!');
      process.exit(0);
    } else {
      error(`\n❌ ${failed} test(s) failed`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
