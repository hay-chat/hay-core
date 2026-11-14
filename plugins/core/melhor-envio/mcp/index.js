#!/usr/bin/env node
/**
 * Local Node MCP server for Melhor Envio.
 *
 * Read-only shipment tracking for "where is my order" conversations: two tools,
 * one per support step, not one per Melhor Envio endpoint.
 *
 * Env (injected by the plugin worker):
 *   MELHOR_ENVIO_ACCESS_TOKEN     bearer token generated in the merchant's panel
 *   MELHOR_ENVIO_USER_AGENT       "App (contact email)", required by Melhor Envio
 *   STALE_TRACKING_DOMESTIC_DAYS  optional stale-tracking threshold (default 5)
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { applyToolRisk } = require("@hay/plugin-sdk/tool-risk");
const toolRisk = require("./tool-risk");

const { registerShipmentTools } = require("./tools/shipments");

function createServer() {
  const server = applyToolRisk(new McpServer({ name: "melhor-envio", version: "1.0.0" }), toolRisk);
  registerShipmentTools(server);
  return server;
}

async function main() {
  if (!process.env.MELHOR_ENVIO_ACCESS_TOKEN || !process.env.MELHOR_ENVIO_USER_AGENT) {
    console.error(
      "ERROR: MELHOR_ENVIO_ACCESS_TOKEN and MELHOR_ENVIO_USER_AGENT environment variables are required",
    );
    process.exit(1);
  }
  await createServer().connect(new StdioServerTransport());
  console.error("[melhor-envio] MCP server started");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Melhor Envio MCP server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createServer };
