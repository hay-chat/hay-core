/**
 * Every tool this server registers must carry a risk class, or Hay.chat core
 * treats it as an unknown write and holds it for approval. Connects the real
 * server over an in-memory transport and reads tools/list.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import toolRiskHelper from "@hay/plugin-sdk/tool-risk";
import { server } from "../server.js";
import toolRisk from "../tool-risk.js";

const { CATEGORY_META_KEY } = toolRiskHelper;

describe("tool risk classification", () => {
  let tools;
  beforeAll(async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    tools = (await client.listTools()).tools;
  });

  it("classifies every listed tool", () => {
    expect(tools.length).toBeGreaterThan(0);
    const unclassified = tools
      .filter((t) => t.annotations?.readOnlyHint !== true && !t._meta?.[CATEGORY_META_KEY])
      .map((t) => t.name);
    expect(unclassified).toEqual([]);
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
      } else {
        expect(tool.annotations.readOnlyHint).toBe(false);
        expect(tool._meta[CATEGORY_META_KEY]).toBe(toolRisk.write[tool.name]);
      }
    }
  });
});
