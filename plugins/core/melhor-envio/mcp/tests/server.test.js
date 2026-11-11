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

const EXPECTED_TOOLS = ["melhorenvio_find_customer_shipments", "melhorenvio_track_shipment"];

describe("melhor-envio MCP server (stdio)", () => {
  it("serves exactly the two read-only tools, each labelled in en and pt-BR", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, "..", "index.js")],
      env: {
        ...process.env,
        MELHOR_ENVIO_ACCESS_TOKEN: "tok",
        MELHOR_ENVIO_USER_AGENT: "Hay (dev@store.test)",
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
        expect(tool.annotations.readOnlyHint).toBe(true);
      }
      for (const locale of ["en", "pt-BR"]) {
        const messages = require(`../../i18n/${locale}.json`);
        expect(Object.keys(messages.tools).sort()).toEqual(EXPECTED_TOOLS);
      }
    } finally {
      await client.close();
    }
  }, 20000);
});
