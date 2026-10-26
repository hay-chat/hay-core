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
  "wix_cancel_order",
  "wix_create_refund",
  "wix_find_customer",
  "wix_get_order",
  "wix_get_order_tracking",
  "wix_get_product",
  "wix_list_customer_orders",
  "wix_search_products",
  "wix_update_order_shipping_address",
];

describe("wix MCP server (stdio)", () => {
  it("serves exactly the semantic tool set", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, "..", "index.js")],
      env: { ...process.env, WIX_API_KEY: "k", WIX_SITE_ID: "s" },
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
