#!/usr/bin/env node
/**
 * Local Node MCP server for Wix Stores.
 *
 * Calls the Wix eCommerce REST API directly (https://www.wixapis.com) using a
 * site-scoped API key. Exposes the eCommerce surface an AI support agent needs:
 * order lookup + status, transaction history, refunds (with an external-refund
 * fallback when the provider can't be refunded via API), fulfilment management,
 * and read-only catalog browsing.
 *
 * Env (injected by the plugin worker):
 *   WIX_API_KEY   site-scoped Wix API key (sent raw in the Authorization header)
 *   WIX_SITE_ID   the Wix site ID the key is scoped to (wix-site-id header)
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { registerOrderTools } = require("./tools/orders");
const { registerRefundTools } = require("./tools/refunds");
const { registerFulfillmentTools } = require("./tools/fulfillments");
const { registerProductTools } = require("./tools/products");

const server = new McpServer({ name: "wix-stores", version: "1.0.0" });

registerOrderTools(server);
registerRefundTools(server);
registerFulfillmentTools(server);
registerProductTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[wix] MCP server started");
}

main().catch((err) => {
  console.error("Wix Stores MCP server failed to start:", err);
  process.exit(1);
});
