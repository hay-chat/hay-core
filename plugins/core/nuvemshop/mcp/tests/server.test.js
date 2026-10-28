/**
 * Boundary test: spawn the real MCP server over stdio and list its tools, the
 * same handshake the plugin worker performs. Pins the exact tool surface and
 * the read/write annotations core caches (server/services/plugin-tools.service.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const EXPECTED_TOOLS = [
  "nuvemshop_add_order_note",
  "nuvemshop_cancel_order",
  "nuvemshop_check_inventory",
  "nuvemshop_check_refund_status",
  "nuvemshop_create_coupon",
  "nuvemshop_find_customer",
  "nuvemshop_get_customer",
  "nuvemshop_get_order",
  "nuvemshop_get_order_tracking",
  "nuvemshop_get_payment_link",
  "nuvemshop_get_product",
  "nuvemshop_get_store",
  "nuvemshop_list_categories",
  "nuvemshop_list_customer_orders",
  "nuvemshop_request_refund",
  "nuvemshop_search_products",
  "nuvemshop_update_order_shipping_address",
];

const WRITE_TOOLS = new Set([
  "nuvemshop_add_order_note",
  "nuvemshop_cancel_order",
  "nuvemshop_create_coupon",
  "nuvemshop_request_refund",
  "nuvemshop_update_order_shipping_address",
]);

const toolRisk = require("../tool-risk");

describe("nuvemshop MCP server (stdio)", () => {
  it("serves exactly the semantic tool set with read/write annotations", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, "..", "index.js")],
      env: { ...process.env, NUVEMSHOP_STORE_ID: "1", NUVEMSHOP_ACCESS_TOKEN: "tok" },
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
        expect(tool.annotations.readOnlyHint).toBe(!WRITE_TOOLS.has(tool.name));
        // Risk class from tool-risk.js reaches tools/list (core gates on it).
        expect(tool._meta?.["chat.hay/category"]).toBe(toolRisk.write[tool.name]);
      }
    } finally {
      await client.close();
    }
  }, 20000);
});

describe("i18n", () => {
  it("labels exactly the served tools in every locale (pt-BR matches the dashboard locale)", () => {
    const dir = path.join(__dirname, "..", "..", "i18n");
    expect(fs.readdirSync(dir).sort()).toEqual(["en.json", "es.json", "pt-BR.json"]);
    for (const file of ["en.json", "es.json", "pt-BR.json"]) {
      const locale = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      expect(Object.keys(locale.tools).sort()).toEqual(EXPECTED_TOOLS);
    }
  });
});
