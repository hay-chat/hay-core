import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * D1: the store's customer id links a conversation only with the signature
 * the store's server computed, so the widget sends both, together.
 */

describe("useChat create sends the signed customer id", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  let createBodies: Record<string, unknown>[];

  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.spyOn(console, "error").mockImplementation(() => {});
    sessionStorage.clear();
    createBodies = [];
    mockFetch({
      "publicConversations.create": (body) => {
        createBodies.push(body);
        return { data: { id: "conv-1", nonce: "n1", createdAt: "2026-10-28T10:00:00.000Z" } };
      },
      "publicConversations.sendMessage": () => ({
        data: { messageId: "u1", nonce: "n2", createdAt: "2026-10-28T10:00:01.000Z" },
      }),
      "publicConversations.getMessages": () => ({ data: { nonce: "n3", messages: [] } }),
    });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function firstCreateBody(config: Parameters<typeof mountChat>[0]) {
    const { chat, unmount } = await mountChat(config);
    await chat.sendMessage("Hi");
    unmount();
    return createBodies[0];
  }

  it("sends the id with its signature", async () => {
    expect(
      await firstCreateBody({
        customerExternalId: "ana@shop.com",
        customerExternalIdSignature: "ab".repeat(32),
      }),
    ).toMatchObject({
      customerExternalId: "ana@shop.com",
      customerExternalIdSignature: "ab".repeat(32),
    });
  });

  it("sends neither when no customer is configured", async () => {
    const body = await firstCreateBody({ customerExternalIdSignature: "ab".repeat(32) });
    expect(body).not.toHaveProperty("customerExternalId");
    expect(body).not.toHaveProperty("customerExternalIdSignature");
  });
});
