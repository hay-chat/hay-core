/**
 * Boundary test: spawn the real MCP server over stdio and list its tools, the
 * same handshake the plugin worker performs. Pins the exact tool surface.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const EXPECTED_TOOLS = [
  "woocommerce_add_order_note",
  "woocommerce_calculate_refund",
  "woocommerce_cancel_order",
  "woocommerce_check_inventory",
  "woocommerce_create_coupon",
  "woocommerce_create_refund",
  "woocommerce_find_customer",
  "woocommerce_get_order",
  "woocommerce_get_order_tracking",
  "woocommerce_get_product",
  "woocommerce_get_product_by_slug",
  "woocommerce_get_store",
  "woocommerce_list_customer_orders",
  "woocommerce_resend_order_confirmation",
  "woocommerce_search_products",
  "woocommerce_update_customer",
  "woocommerce_update_customer_address",
  "woocommerce_update_order_shipping_address",
];

describe("woocommerce MCP server (stdio)", () => {
  it("serves exactly the semantic tool set", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, "..", "index.js")],
      env: {
        ...process.env,
        WORDPRESS_SITE_URL: "https://store.test",
        WOOCOMMERCE_CONSUMER_KEY: "ck",
        WOOCOMMERCE_CONSUMER_SECRET: "cs",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
      for (const tool of tools) {
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.inputSchema.type).toBe("object");
      }
      // Risk classes reach tools/list, where Hay.chat core reads them.
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      expect(byName.woocommerce_get_order.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
      });
      expect(byName.woocommerce_create_refund.annotations.readOnlyHint).toBe(false);
      expect(byName.woocommerce_create_refund._meta).toEqual({ "chat.hay/category": "refund" });
      // The coupon tool enforces its own cap; core reads the flag and the approval arg.
      expect(byName.woocommerce_create_coupon._meta).toEqual({
        "chat.hay/category": "discount",
        "chat.hay/capEnforced": true,
      });
      expect(byName.woocommerce_create_coupon.inputSchema.properties).toHaveProperty(
        "hay_approval_id",
      );
    } finally {
      await client.close();
    }
  }, 20000);
});
