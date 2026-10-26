#!/usr/bin/env node
/**
 * Local Node MCP server for Magento 2.
 *
 * Exposes the semantic support actions a customer-facing agent needs — not
 * one tool per Magento endpoint and no merchant analytics. Reads merge
 * several endpoints (order + shipments + invoices), writes are bounded
 * server-side (cancel only before invoicing, address change only before
 * shipment, refund capped at paid minus refunded and never silently offline).
 *
 * Env (injected by the plugin worker):
 *   MAGENTO_BASE_URL   e.g. https://store.example.com/rest/V1
 *   MAGENTO_API_TOKEN  integration access token
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { registerStoreTools } = require("./tools/store");
const { registerCustomerTools } = require("./tools/customers");
const { registerOrderTools } = require("./tools/orders");
const { registerRefundTools } = require("./tools/refunds");
const { registerProductTools } = require("./tools/products");

function createServer() {
  const server = new McpServer({ name: "magento", version: "2.0.0" });
  registerStoreTools(server);
  registerCustomerTools(server);
  registerOrderTools(server);
  registerRefundTools(server);
  registerProductTools(server);
  return server;
}

async function main() {
  if (!process.env.MAGENTO_BASE_URL || !process.env.MAGENTO_API_TOKEN) {
    console.error(
      "ERROR: MAGENTO_BASE_URL and MAGENTO_API_TOKEN environment variables are required",
    );
    process.exit(1);
  }
  await createServer().connect(new StdioServerTransport());
  console.error("[magento] MCP server started");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Magento MCP server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createServer };
