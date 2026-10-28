/**
 * Every tool this server registers must carry a risk class, or Hay.chat core
 * treats it as an unknown write and holds it for approval. Boots the real
 * server (stdio swapped for an in-memory transport) and reads tools/list.
 */
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll } from "vitest";

const require = createRequire(import.meta.url);
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { CATEGORY_META_KEY } = require("@hay/plugin-sdk/tool-risk");
const toolRisk = require("../tool-risk");

async function listServerTools() {
  process.env.TWENTY_URL = "https://crm.example.com";
  process.env.TWENTY_API_KEY = "test-key";
  const connect = McpServer.prototype.connect;
  let booted;
  McpServer.prototype.connect = async function () {
    booted = this; // the server index.js builds; skip its stdio transport
  };
  try {
    require("../index.js");
  } finally {
    McpServer.prototype.connect = connect;
  }
  await Promise.resolve();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await booted.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return (await client.listTools()).tools;
}

describe("tool risk classification", () => {
  let tools;
  beforeAll(async () => {
    tools = await listServerTools();
  });

  it("classifies every listed tool", () => {
    expect(tools.length).toBeGreaterThan(0);
    const unclassified = tools
      .filter((t) => t.annotations?.readOnlyHint !== true && !t._meta?.[CATEGORY_META_KEY])
      .map((t) => t.name);
    expect(unclassified).toEqual(toolRisk.unclassified ?? []);
  });

  it("lists no tool that is not registered", () => {
    const names = tools.map((t) => t.name);
    const listed = [...toolRisk.read, ...Object.keys(toolRisk.write)];
    expect(listed.filter((name) => !names.includes(name))).toEqual([]);
  });

  it("carries the declared class on the wire", () => {
    for (const tool of tools) {
      if (toolRisk.read.includes(tool.name)) {
        expect(tool.annotations.readOnlyHint).toBe(true);
      } else if (toolRisk.write[tool.name]) {
        expect(tool.annotations.readOnlyHint).toBe(false);
        expect(tool._meta[CATEGORY_META_KEY]).toBe(toolRisk.write[tool.name]);
      }
    }
  });
});
