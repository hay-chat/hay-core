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

describe("PluginHttpServer webchat gate endpoint", () => {
  let server: PluginHttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const registry = new PluginRegistry();
    registry.registerConfig({ mode: { type: "string" } });
    registry.registerWebchatGate({
      event: "conversation.create",
      timeoutMs: 3000,
      failurePolicy: "open",
      handler: (ctx, input) => ({
        decision: input.token === "good" ? "allow" : "deny",
        reason: `${ctx.org.id}:${String(ctx.config.get("mode"))}:${input.event}`,
      }),
    });
    registry.registerWebchatGate({
      event: "message.send",
      timeoutMs: 3000,
      failurePolicy: "open",
      handler: () => ({ decision: "maybe" }) as never,
    });
    server = new PluginHttpServer(0, registry, silentLogger);
    server.setRuntimeData({
      orgId: "org-1",
      manifest: { env: [] },
      mcpRuntime: {} as never,
      orgConfig: {},
      orgAuth: null,
    });
    await server.start();
    const address = (server as unknown as { server: { address(): AddressInfo } }).server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  const post = (event: string, body: unknown) =>
    fetch(`${baseUrl}/webchat/gate/${event}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("runs the handler with the config Core sent and returns its decision", async () => {
    const response = await post("conversation.create", {
      config: { mode: "invisible" },
      input: { token: "good", event: "message.send" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      decision: "allow",
      reason: "org-1:invisible:conversation.create",
    });
  });

  it("returns 500 for an invalid decision so Core applies the failure policy", async () => {
    const response = await post("message.send", { config: {}, input: {} });
    expect(response.status).toBe(500);
  });

  it("returns 404 for an event without a gate", async () => {
    const response = await post("page.view", { config: {}, input: {} });
    expect(response.status).toBe(404);
  });
});

describe("PluginHttpServer setup status endpoint", () => {
  const start = async (registry: PluginRegistry) => {
    const server = new PluginHttpServer(0, registry, silentLogger);
    server.setRuntimeData({
      orgId: "org-1",
      manifest: { env: [] },
      mcpRuntime: {} as never,
      orgConfig: { shopDomain: "stored.example" },
      orgAuth: null,
    });
    await server.start();
    const address = (server as unknown as { server: { address(): AddressInfo } }).server.address();
    return { server, baseUrl: `http://127.0.0.1:${address.port}` };
  };
  const post = (baseUrl: string, body: unknown) =>
    fetch(`${baseUrl}/setup/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("runs the status handler with the config and auth Core sent", async () => {
    const registry = new PluginRegistry();
    registry.registerConfig({ shopDomain: { type: "string" } });
    registry.registerSetup({
      steps: [{ id: "connect", kind: "connect" }],
      status: ({ auth, config, org }) => ({
        state: auth.get() ? "connected" : "needs_action",
        account: `${org.id}:${String(config.get("shopDomain"))}`,
        steps: { connect: { done: !!auth.get(), message: "x".repeat(300) }, bad: {} as never },
      }),
    });
    const { server, baseUrl } = await start(registry);
    try {
      const response = await post(baseUrl, {
        config: { shopDomain: "sent.example" },
        authState: { methodId: "oauth", credentials: { accessToken: "t" } },
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.state).toBe("connected");
      expect(body.account).toBe("org-1:sent.example");
      expect(body.steps.connect.done).toBe(true);
      expect(body.steps.connect.message).toHaveLength(200);
      expect(body.steps.bad).toBeUndefined();
    } finally {
      await server.stop();
    }
  });

  it("returns 500 for an invalid state and 404 without a handler", async () => {
    const invalid = new PluginRegistry();
    invalid.registerSetup({
      steps: [{ id: "connect", kind: "connect" }],
      status: () => ({ state: "great" }) as never,
    });
    const a = await start(invalid);
    const none = new PluginRegistry();
    none.registerSetup({ steps: [{ id: "connect", kind: "connect" }] });
    const b = await start(none);
    try {
      expect((await post(a.baseUrl, {})).status).toBe(500);
      expect((await post(b.baseUrl, {})).status).toBe(404);
    } finally {
      await a.server.stop();
      await b.server.stop();
    }
  });
});

describe("PluginHttpServer worker secret", () => {
  const secret = "s".repeat(64);
  let server: PluginHttpServer;
  let baseUrl: string;
  let seenSecretHeader: unknown = "unset";

  beforeAll(async () => {
    const registry = new PluginRegistry();
    registry.registerRoute({
      method: "POST",
      path: "/webhook",
      handler: async (req, res) => {
        seenSecretHeader = req.headers["x-hay-worker-secret"];
        res.json({ ok: true });
      },
    });
    server = new PluginHttpServer(0, registry, silentLogger, { secret });
    await server.start();
    const address = (server as unknown as { server: { address(): AddressInfo } }).server.address();
    expect(address.address).toBe("127.0.0.1");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it.each(["/metadata", "/health", "/mcp/list-tools", "/webhook"])(
    "rejects %s without the secret",
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: path === "/webhook" ? "POST" : "GET",
      });
      expect(response.status).toBe(401);
    },
  );

  it("rejects a wrong secret", async () => {
    const response = await fetch(`${baseUrl}/metadata`, {
      headers: { "x-hay-worker-secret": "wrong" },
    });
    expect(response.status).toBe(401);
  });

  it("serves requests with the secret and hides it from plugin handlers", async () => {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "x-hay-worker-secret": secret, "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(seenSecretHeader).toBeUndefined();
  });
});
