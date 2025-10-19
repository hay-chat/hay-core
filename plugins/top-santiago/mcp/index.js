#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { server } from './server.js';
import dotenv from 'dotenv';

/**
 * Top Santiago MCP Server Entry Point
 *
 * This file starts the MCP server and connects it to stdio transport.
 * The stdio transport allows the server to communicate with clients
 * through standard input/output streams.
 */

// Load environment variables from .env file
dotenv.config();

// Verify API key is configured
if (!process.env.TOP_SANTIAGO_API_KEY) {
  console.error('[Top Santiago MCP] WARNING: TOP_SANTIAGO_API_KEY environment variable is not set!');
  console.error('[Top Santiago MCP] The plugin will not function without a valid API key.');
}

console.error('[Top Santiago MCP] Starting server...');
console.error('[Top Santiago MCP] API URL:', process.env.TOP_SANTIAGO_API_URL || 'https://api.sandbox.topsantiago.com');

// Create a stdio transport for communication
const transport = new StdioServerTransport();

// Connect the server to the transport
await server.connect(transport);

console.error('[Top Santiago MCP] Server connected and ready!');
