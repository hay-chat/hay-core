#!/usr/bin/env node
/**
 * Local Node MCP server for Correios: shipment tracking over the CWS REST APIs
 * (Token + SRO Rastro), with the merchant's own contract credentials.
 *
 * Plain CommonJS on native fetch, spawned over stdio by src/index.ts.
 * stdout carries JSON-RPC only — log to stderr.
 *
 * Env (injected by the plugin worker):
 *   CORREIOS_USERNAME, CORREIOS_ACCESS_CODE, CORREIOS_POSTING_CARD,
 *   CORREIOS_CONTRACT, STALE_TRACKING_DOMESTIC_DAYS
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { applyToolRisk } = require("@hay/plugin-sdk/tool-risk");
const toolRisk = require("./tool-risk");
const { registerTrackingTools } = require("./tools/tracking");

function createServer() {
  const server = applyToolRisk(new McpServer({ name: "correios", version: "1.0.0" }), toolRisk);
  registerTrackingTools(server);
  return server;
}

async function main() {
  if (!process.env.CORREIOS_USERNAME || !process.env.CORREIOS_ACCESS_CODE) {
    console.error("ERROR: CORREIOS_USERNAME and CORREIOS_ACCESS_CODE are required");
    process.exit(1);
  }
  await createServer().connect(new StdioServerTransport());
  console.error("[correios] MCP server started");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Correios MCP server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createServer };
