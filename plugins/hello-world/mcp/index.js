#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { server } from './server.js';
import dotenv from 'dotenv';

/**
 * Hello World MCP Server Entry Point
 *
 * This file starts the MCP server and connects it to stdio transport.
 * The stdio transport allows the server to communicate with clients
 * through standard input/output streams.
 */

// Load environment variables from .env file (if it exists)
dotenv.config();

console.error('[Hello World MCP] Starting server...');

// Create a stdio transport for communication
const transport = new StdioServerTransport();

// Connect the server to the transport
await server.connect(transport);

console.error('[Hello World MCP] Server connected and ready!');
