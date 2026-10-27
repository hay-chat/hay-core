#!/usr/bin/env node
/**
 * Local Node MCP server for Nuvemshop / Tiendanube.
 *
 * Exposes the semantic support actions a customer-facing agent needs — not
 * one tool per REST endpoint. Reads merge several endpoints (order +
 * fulfillment orders + transactions, customer account + guest orders), writes
 * are bounded server-side (pre-dispatch only, identity match before payment
 * details, coupon caps from the merchant's settings, refunds recorded but
 * never claimed: the Nuvemshop API cannot move money).
 *
 * Plain CommonJS on native fetch, spawned over stdio by src/index.ts.
 * stdout carries JSON-RPC only — log to stderr.
 *
 * Env (injected by the plugin worker):
 *   NUVEMSHOP_STORE_ID, NUVEMSHOP_ACCESS_TOKEN, NUVEMSHOP_API_VERSION,
 *   NUVEMSHOP_MAIN_LANGUAGE, NUVEMSHOP_COUPONS_ENABLED,
 *   NUVEMSHOP_COUPON_MAX_PERCENT, NUVEMSHOP_COUPON_MAX_AMOUNT, NUVEMSHOP_COUPON_MAX_DAYS
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { registerStoreTools } = require("./tools/store");
const { registerCustomerTools } = require("./tools/customers");
const { registerOrderTools } = require("./tools/orders");
const { registerRefundTools } = require("./tools/refunds");
const { registerPaymentTools } = require("./tools/payments");
const { registerCouponTools } = require("./tools/coupons");
const { registerProductTools } = require("./tools/products");

function createServer() {
  const server = new McpServer({ name: "nuvemshop", version: "2.0.0" });
  registerStoreTools(server);
  registerCustomerTools(server);
  registerOrderTools(server);
  registerRefundTools(server);
  registerPaymentTools(server);
  registerCouponTools(server);
  registerProductTools(server);
  return server;
}

async function main() {
  if (!process.env.NUVEMSHOP_STORE_ID || !process.env.NUVEMSHOP_ACCESS_TOKEN) {
    console.error("ERROR: NUVEMSHOP_STORE_ID and NUVEMSHOP_ACCESS_TOKEN are required");
    process.exit(1);
  }
  await createServer().connect(new StdioServerTransport());
  console.error("[nuvemshop] MCP server started");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Nuvemshop MCP server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createServer };
