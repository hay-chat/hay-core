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
  "magento_add_order_note",
  "magento_cancel_order",
  "magento_check_inventory",
  "magento_create_refund",
  "magento_find_customer",
  "magento_get_order",
  "magento_get_order_tracking",
  "magento_get_product",
  "magento_get_store",
  "magento_list_customer_orders",
  "magento_resend_order_confirmation",
  "magento_search_products",
  "magento_update_order_shipping_address",
];

describe("magento MCP server (stdio)", () => {
  it("serves exactly the semantic tool set", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, "..", "index.js")],
      env: {
        ...process.env,
        MAGENTO_BASE_URL: "https://store.test/rest/V1",
        MAGENTO_API_TOKEN: "tok",
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
    } finally {
      await client.close();
    }
  }, 20000);
});
