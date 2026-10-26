#!/usr/bin/env node
/**
 * Local Node MCP server for Wix Stores.
 *
 * Exposes the semantic support actions a customer-facing agent needs — not
 * one tool per Wix endpoint. Reads merge several endpoints (order +
 * transactions + fulfilments), writes are bounded server-side (pre-dispatch
 * only, refund capped at the remaining balance).
 *
 * Env (injected by the plugin worker):
 *   WIX_API_KEY   site-scoped Wix API key (sent raw in the Authorization header)
 *   WIX_SITE_ID   the Wix site ID the key is scoped to (wix-site-id header)
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { registerCustomerTools } = require("./tools/customers");
const { registerOrderTools } = require("./tools/orders");
const { registerRefundTools } = require("./tools/refunds");
const { registerProductTools } = require("./tools/products");

function createServer() {
  const server = new McpServer({ name: "wix-stores", version: "2.0.0" });
  registerCustomerTools(server);
  registerOrderTools(server);
  registerRefundTools(server);
  registerProductTools(server);
  return server;
}

async function main() {
  if (!process.env.WIX_API_KEY || !process.env.WIX_SITE_ID) {
    console.error("ERROR: WIX_API_KEY and WIX_SITE_ID environment variables are required");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  console.error("[wix] MCP server started");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Wix Stores MCP server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createServer };
