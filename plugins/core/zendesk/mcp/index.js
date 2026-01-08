#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Note: Use console.error() for logging in stdio MCP servers (stdout is reserved for JSON-RPC)
console.error("Starting Zendesk API MCP server...");

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
