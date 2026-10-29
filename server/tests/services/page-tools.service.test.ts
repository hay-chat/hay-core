import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * Page tools (WebMCP): the registry the widget fills on identify and the
 * tool_call / tool_result round-trip the orchestrator awaits.
 */

const mockPublish = jest.fn<(channel: string, data: unknown) => Promise<void>>(async () => {});
const mockSubscribe = jest.fn<(channel: string, handler: (data: unknown) => void) => Promise<void>>(
  async () => {},
);
const mockSendToConversation = jest.fn<(id: string, frame: Record<string, unknown>) => number>(
  () => 1,
);
let redisConnected = false;
const store = new Map<string, string>();
const fakeClient = {
  set: jest.fn(async (key: string, value: string, ..._ttl: unknown[]) => {
    store.set(key, value);
  }),
  get: jest.fn(async (key: string) => store.get(key) ?? null),
  del: jest.fn(async (key: string) => {
    store.delete(key);
  }),
};

jest.mock("@server/services/redis.service", () => ({
  redisService: {
    publish: mockPublish,
    subscribe: mockSubscribe,
    isConnected: () => redisConnected,
    getClient: () => fakeClient,
  },
}));
jest.mock("@server/services/websocket.service", () => ({
  websocketService: { sendToConversation: mockSendToConversation },
}));

import {
  pageToolService,
  validatePageTools,
  unwrapPageToolResult,
  PageToolValidationError,
  PAGE_TOOL_CALL_EVENT,
} from "@server/services/webchat/page-tools.service";

describe("validatePageTools", () => {
  it("keeps name, description, schema and the read-only hint", () => {
    const tools = validatePageTools([
      {
        name: "add_to_cart",
        description: "  Add a variant to the cart ",
        inputSchema: { type: "object", properties: { variantId: { type: "string" } } },
        annotations: { readOnlyHint: false, destructiveHint: true },
        execute: "not sent",
      },
      { name: "open-cart", description: "Open the cart drawer" },
    ]);
    expect(tools).toEqual([
      {
        name: "add_to_cart",
        description: "Add a variant to the cart",
        inputSchema: { type: "object", properties: { variantId: { type: "string" } } },
        annotations: { readOnlyHint: false },
      },
      { name: "open-cart", description: "Open the cart drawer", inputSchema: { type: "object" } },
    ]);
  });

  it("refuses bad names, duplicates, missing descriptions and too many tools", () => {
    const bad = (input: unknown) =>
      expect(() => validatePageTools(input)).toThrow(PageToolValidationError);
    bad("nope");
    bad([{ name: "has space", description: "x" }]);
    bad([{ name: "page:evil", description: "x" }]);
    bad([{ name: "a", description: "" }]);
    bad([
      { name: "a", description: "x" },
      { name: "a", description: "y" },
    ]);
    bad(Array.from({ length: 33 }, (_, i) => ({ name: `t${i}`, description: "x" })));
  });
});

describe("unwrapPageToolResult", () => {
  it("joins MCP text content and passes other values through", () => {
    expect(unwrapPageToolResult({ content: [{ type: "text", text: "Added." }] })).toBe("Added.");
    expect(unwrapPageToolResult({ ok: true })).toEqual({ ok: true });
    expect(unwrapPageToolResult("plain")).toBe("plain");
  });

  it("turns isError into a thrown error", () => {
    expect(() =>
      unwrapPageToolResult({ isError: true, content: [{ type: "text", text: "Out of stock" }] }),
    ).toThrow("Out of stock");
  });
});

describe("pageToolService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    redisConnected = false;
  });

  it("registers, lists and clears tools per conversation", async () => {
    await pageToolService.register("conv-1", [
      { name: "navigate", description: "Go to a page", inputSchema: { type: "object" } },
    ]);
    expect((await pageToolService.list("conv-1")).map((t) => t.name)).toEqual(["navigate"]);
    expect(await pageToolService.list("conv-2")).toEqual([]);
    await pageToolService.clear("conv-1");
    expect(await pageToolService.list("conv-1")).toEqual([]);
  });

  it("uses Redis with a TTL when it is connected", async () => {
    redisConnected = true;
    await pageToolService.register("conv-1", [
      { name: "navigate", description: "Go to a page", inputSchema: { type: "object" } },
    ]);
    expect(fakeClient.set).toHaveBeenCalledWith(
      "webchat:page-tools:conv-1",
      expect.any(String),
      "EX",
      3600,
    );
    expect((await pageToolService.list("conv-1")).map((t) => t.name)).toEqual(["navigate"]);
  });

  it("sends tool_call to the page and resolves with the page's answer", async () => {
    const pending = pageToolService.call("conv-1", "org-1", "navigate", { path: "/inbox" });
    await new Promise((r) => setImmediate(r));
    expect(mockSendToConversation).toHaveBeenCalledWith("conv-1", {
      type: "tool_call",
      callId: expect.any(String),
      name: "navigate",
      args: { path: "/inbox" },
    });
    const { callId } = (mockSendToConversation.mock.calls[0] as unknown[])[1] as { callId: string };
    await pageToolService.resolve(callId, { result: { content: [{ type: "text", text: "ok" }] } });
    await expect(pending).resolves.toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("rejects when the page reports an error", async () => {
    const pending = pageToolService.call("conv-1", "org-1", "navigate", {});
    await new Promise((r) => setImmediate(r));
    const { callId } = (mockSendToConversation.mock.calls[0] as unknown[])[1] as { callId: string };
    await pageToolService.resolve(callId, { error: "No such route" });
    await expect(pending).rejects.toThrow("No such route");
  });

  it("fails fast when no page is connected, and times out when it never answers", async () => {
    mockSendToConversation.mockReturnValueOnce(0);
    await expect(pageToolService.call("conv-1", "org-1", "navigate", {})).rejects.toThrow(
      'No page is connected to run "navigate"',
    );

    await expect(pageToolService.call("conv-1", "org-1", "navigate", {}, 20)).rejects.toThrow(
      "did not answer",
    );
  });

  it("goes through Redis on both legs when the socket may be elsewhere", async () => {
    redisConnected = true;
    const pending = pageToolService.call("conv-1", "org-1", "navigate", {}, 500);
    await new Promise((r) => setImmediate(r));
    expect(mockSubscribe).toHaveBeenCalledWith("webchat:page-tool-results", expect.any(Function));
    expect(mockPublish).toHaveBeenCalledWith("websocket:events", {
      type: PAGE_TOOL_CALL_EVENT,
      organizationId: "org-1",
      conversationId: "conv-1",
      payload: { callId: expect.any(String), name: "navigate", args: {} },
    });
    expect(mockSendToConversation).not.toHaveBeenCalled();

    // The instance holding the socket does not know the call: it publishes the result.
    await pageToolService.resolve("someone-elses-call", { result: 1 });
    expect(mockPublish).toHaveBeenLastCalledWith("webchat:page-tool-results", {
      callId: "someone-elses-call",
      result: 1,
    });

    // This instance gets its own answer back over the channel.
    const sent = (mockPublish.mock.calls[0] as unknown[])[1] as { payload: { callId: string } };
    const handler = (mockSubscribe.mock.calls[0] as unknown[])[1] as (e: unknown) => void;
    handler({ callId: sent.payload.callId, result: "done" });
    await expect(pending).resolves.toBe("done");
  });
});
