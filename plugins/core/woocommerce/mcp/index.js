#!/usr/bin/env node
/**
 * Local Node MCP server for WooCommerce.
 *
 * Exposes the semantic support actions a customer-facing agent needs — not
 * one tool per WooCommerce REST endpoint. Reads merge several endpoints
 * (order + shipment tracking from whichever plugin the store runs, customer
 * account + guest orders), writes are bounded server-side (pre-dispatch
 * only, refund capped at the remaining balance, unpaid orders refused).
 *
 * Env (injected by the plugin worker):
 *   WORDPRESS_SITE_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET
 *   optional: WOOCOMMERCE_COUPONS_ENABLED, WOOCOMMERCE_COUPON_MAX_PERCENT,
 *   WOOCOMMERCE_COUPON_MAX_AMOUNT, WOOCOMMERCE_COUPON_MAX_DAYS (goodwill coupon cap),
 *   STALE_TRACKING_DOMESTIC_DAYS, STALE_TRACKING_INTERNATIONAL_DAYS
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { applyToolRisk } = require("@hay/plugin-sdk/tool-risk");
const toolRisk = require("./tool-risk");

const { registerStoreTools } = require("./tools/store");
const { registerCustomerTools } = require("./tools/customers");
const { registerOrderTools } = require("./tools/orders");
const { registerRefundTools } = require("./tools/refunds");
const { registerProductTools } = require("./tools/products");
const { registerCouponTools } = require("./tools/coupons");
const { registerOrderEmailTools } = require("./tools/order-emails");

function createServer() {
  const server = applyToolRisk(new McpServer({ name: "woocommerce", version: "2.0.0" }), toolRisk);
  registerStoreTools(server);
  registerCustomerTools(server);
  registerOrderTools(server);
  registerRefundTools(server);
  registerProductTools(server);
  registerCouponTools(server);
  registerOrderEmailTools(server);
  return server;
}

async function main() {
  if (
    !process.env.WORDPRESS_SITE_URL ||
    !process.env.WOOCOMMERCE_CONSUMER_KEY ||
    !process.env.WOOCOMMERCE_CONSUMER_SECRET
  ) {
    console.error(
      "ERROR: WORDPRESS_SITE_URL, WOOCOMMERCE_CONSUMER_KEY and WOOCOMMERCE_CONSUMER_SECRET are required",
    );
    process.exit(1);
  }
  await createServer().connect(new StdioServerTransport());
  console.error("[woocommerce] MCP server started");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("WooCommerce MCP server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createServer };
