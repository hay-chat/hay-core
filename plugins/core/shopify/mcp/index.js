#!/usr/bin/env node
/**
 * Local Node MCP server for Shopify (HAY-219).
 *
 * Calls the Shopify Admin GraphQL API (version from SHOPIFY_API_VERSION) using
 * an access token injected by the plugin worker — works identically for managed
 * (OAuth offline token) and self-hosted (client-credentials) modes.
 *
 * Tool modules live under ./tools and share ./lib/{client,format}.js.
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { registerShopTools } = require("./tools/shop");
const { registerOrderTools } = require("./tools/orders");
const { registerFulfillmentTools } = require("./tools/fulfillments");
const { registerCustomerTools } = require("./tools/customers");
const { registerProductTools } = require("./tools/products");
const { registerInventoryTools } = require("./tools/inventory");

const server = new McpServer({ name: "shopify", version: "1.0.0" });

registerShopTools(server);
registerOrderTools(server);
registerFulfillmentTools(server);
registerCustomerTools(server);
registerProductTools(server);
registerInventoryTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[shopify] MCP server started");
}

main().catch((err) => {
  console.error("Shopify MCP server failed to start:", err);
  process.exit(1);
});
