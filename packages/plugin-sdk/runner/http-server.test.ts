import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
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
