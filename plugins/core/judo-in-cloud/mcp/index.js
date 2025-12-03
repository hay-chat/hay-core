#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { server } from './server.js';
import dotenv from 'dotenv';

/**
 * Judo in Cloud MCP Server Entry Point
 *
 * This file starts the MCP server and connects it to stdio transport.
 * The stdio transport allows the server to communicate with clients
 * through standard input/output streams.
 */

// Load environment variables from .env file (if it exists)
dotenv.config();

console.error('[Judo in Cloud MCP] Starting server...');

// Create a stdio transport for communication
const transport = new StdioServerTransport();

// Connect the server to the transport
server
  .connect(transport)
  .then(() => {
    console.error('[Judo in Cloud MCP] Server connected and ready!');
  })
  .catch((error) => {
    console.error('[Judo in Cloud MCP] Failed to start MCP server:', error);
    process.exit(1);
  });
