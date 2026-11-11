/**
 * Boundary test: spawn the real MCP server over stdio and list its tools, the
 * same handshake the plugin worker performs.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

describe("correios MCP server (stdio)", () => {
  it("serves the tracking tool as a read with a described schema", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, "..", "index.js")],
      env: { ...process.env, CORREIOS_USERNAME: "user", CORREIOS_ACCESS_CODE: "code" },
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["correios_track_shipment"]);
      const [tool] = tools;
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.required).toEqual(["tracking_code"]);
      expect(tool.inputSchema.properties.tracking_code.description).toContain("AA123456789BR");
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool._meta?.["chat.hay/category"]).toBeUndefined();
    } finally {
      await client.close();
    }
  }, 20000);
});
