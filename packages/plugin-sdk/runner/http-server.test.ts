import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import { createServer, type Server as HttpServer } from "http";
import { PluginHttpServer } from "./http-server.js";
import { PluginRegistry } from "../sdk/registry.js";
import type { HayLogger } from "../types/index.js";

const silentLogger: HayLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("PluginHttpServer body handling", () => {
  let server: PluginHttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const registry = new PluginRegistry();
    registry.registerRoute({
      method: "POST",
      path: "/webhook",
      handler: async (req, res) => {
        res.json({
          rawLength: typeof req.rawBody === "string" ? req.rawBody.length : null,
          rawEqualsParsed: req.rawBody === JSON.stringify(req.body),
          parsedKeys: Object.keys(req.body ?? {}),
        });
      },
    });
    server = new PluginHttpServer(0, registry, silentLogger);
    await server.start();
    const address = (server as unknown as { server: { address(): AddressInfo } }).server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it("accepts a 3 MB JSON webhook and exposes the exact raw bytes", async () => {
    const body = JSON.stringify({ entry: "x".repeat(3 * 1024 * 1024) });

    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rawLength: body.length,
      rawEqualsParsed: true,
      parsedKeys: ["entry"],
    });
  });

  it("keeps whitespace and key order in rawBody for signature checks", async () => {
    const body = '{"b": 1,   "a": "🙂"}';

    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(await response.json()).toMatchObject({
      rawLength: body.length,
      rawEqualsParsed: false,
      parsedKeys: ["b", "a"],
    });
  });

  it("parses urlencoded bodies and still captures rawBody", async () => {
    const body = "From=whatsapp%3A%2B5511&Body=hi";

    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    expect(await response.json()).toMatchObject({
      rawLength: body.length,
      parsedKeys: ["From", "Body"],
    });
  });

  it("rejects bodies above the worker limit", async () => {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entry: "x".repeat(6 * 1024 * 1024) }),
    });

    expect(response.status).toBe(413);
  });
});

describe("PluginHttpServer /mcp/list-tools tool risk", () => {
  let server: PluginHttpServer;
  let baseUrl: string;
  let remote: HttpServer;

  beforeAll(async () => {
    // A hosted MCP server that annotates one read itself and leaves two writes bare.
    remote = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            tools: [
              { name: "search_docs", annotations: { readOnlyHint: true } },
              { name: "create_refund" },
              { name: "brand_new_tool" },
            ],
          },
        }),
      );
    });
    await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
    const remotePort = (remote.address() as AddressInfo).port;

    server = new PluginHttpServer(0, new PluginRegistry(), silentLogger);
    server.registerMcpServer({
      id: "local-mcp",
      type: "local",
      instance: { listTools: async () => [{ name: "send-email" }, { name: "lookup" }] },
      toolRisk: { read: ["lookup"], write: { "send-email": "other_write" } },
    });
    server.registerMcpServer({
      id: "remote-mcp",
      type: "external",
      options: { id: "remote-mcp", url: `http://127.0.0.1:${remotePort}` },
      toolRisk: { write: { create_refund: "refund" } },
    });
    await server.start();
    const address = (server as unknown as { server: { address(): AddressInfo } }).server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((resolve) => remote.close(() => resolve()));
  });

  it("merges declared risk and keeps the remote server's own annotations", async () => {
    const response = await fetch(`${baseUrl}/mcp/list-tools`);
    const { tools } = (await response.json()) as {
      tools: Array<{ name: string; serverId: string; annotations?: any; _meta?: any }>;
    };
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    expect(byName["send-email"]._meta["chat.hay/category"]).toBe("other_write");
    expect(byName["send-email"].serverId).toBe("local-mcp");
    expect(byName.lookup.annotations.readOnlyHint).toBe(true);
    expect(byName.search_docs.annotations).toEqual({ readOnlyHint: true });
    expect(byName.create_refund._meta["chat.hay/category"]).toBe("refund");
    expect(byName.create_refund.serverId).toBe("remote-mcp");
    // Unknown remote tool: untouched, so core treats it as unclassified (held).
    expect(byName.brand_new_tool.annotations).toBeUndefined();
    expect(byName.brand_new_tool._meta).toBeUndefined();
  });
});
