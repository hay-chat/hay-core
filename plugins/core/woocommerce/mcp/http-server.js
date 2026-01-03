#!/usr/bin/env node
/**
 * HTTP wrapper for WooCommerce MCP server
 *
 * This wraps the stdio-based MCP server with an HTTP interface
 * so it can be used with SDK v2's external MCP pattern.
 */

import express from 'express';
import { spawn } from 'child_process';
import { createInterface } from 'readline';

const app = express();
const port = process.env.MCP_PORT || 3100;

// Track active requests for proper cleanup
const activeRequests = new Map();
let requestIdCounter = 1;
let mcpProcess = null;
let mcpStdin = null;
let mcpStdout = null;

app.use(express.json());

/**
 * Start the stdio-based MCP server as a child process
 */
function startMcpProcess() {
  console.error('[HTTP Wrapper] Starting WooCommerce MCP child process');

  mcpProcess = spawn('node', ['index.js'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  mcpStdin = mcpProcess.stdin;
  mcpStdout = mcpProcess.stdout;

  // Handle responses from MCP process
  const rl = createInterface({
    input: mcpStdout,
    terminal: false,
  });

  rl.on('line', (line) => {
    try {
      const response = JSON.parse(line);
      const { id, result, error } = response;

      if (activeRequests.has(id)) {
        const { resolve, reject } = activeRequests.get(id);
        activeRequests.delete(id);

        if (error) {
          reject(new Error(error.message || 'MCP request failed'));
        } else {
          resolve(result);
        }
      }
    } catch (err) {
      console.error('[HTTP Wrapper] Failed to parse MCP response:', err);
    }
  });

  mcpProcess.stderr.on('data', (data) => {
    console.error('[MCP Server]', data.toString());
  });

  mcpProcess.on('exit', (code, signal) => {
    console.error(`[HTTP Wrapper] MCP process exited with code ${code}, signal ${signal}`);
    mcpProcess = null;
  });

  console.error('[HTTP Wrapper] WooCommerce MCP child process started');
}

/**
 * Send a JSON-RPC request to the MCP process and wait for response
 */
function sendMcpRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!mcpProcess || !mcpStdin) {
      reject(new Error('MCP process not running'));
      return;
    }

    const id = requestIdCounter++;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    // Store the promise handlers
    activeRequests.set(id, { resolve, reject });

    // Set timeout
    setTimeout(() => {
      if (activeRequests.has(id)) {
        activeRequests.delete(id);
        reject(new Error('MCP request timeout'));
      }
    }, 30000); // 30 second timeout

    // Send the request
    mcpStdin.write(JSON.stringify(request) + '\n');
  });
}

/**
 * POST /rpc - Generic JSON-RPC endpoint
 */
app.post('/rpc', async (req, res) => {
  try {
    const { method, params } = req.body;

    if (!method) {
      return res.status(400).json({
        error: 'Missing method parameter',
      });
    }

    const result = await sendMcpRequest(method, params || {});
    res.json({ result });
  } catch (error) {
    console.error('[HTTP Wrapper] RPC error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mcpRunning: mcpProcess !== null,
  });
});

/**
 * Graceful shutdown
 */
process.on('SIGTERM', () => {
  console.error('[HTTP Wrapper] Received SIGTERM, shutting down gracefully');

  if (mcpProcess) {
    mcpProcess.kill('SIGTERM');
  }

  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[HTTP Wrapper] Received SIGINT, shutting down gracefully');

  if (mcpProcess) {
    mcpProcess.kill('SIGTERM');
  }

  process.exit(0);
});

// Start the MCP process and HTTP server
startMcpProcess();

app.listen(port, () => {
  console.error(`[HTTP Wrapper] WooCommerce MCP HTTP server listening on port ${port}`);
});
