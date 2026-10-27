import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";
import { markInteraction } from "../useConsent";
import { getKeypair } from "../useDPoP";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * Regression: the widget showed the greeting twice. The local "Hello!"
 * placeholder stayed pinned and the server's own greeting message (stored by
 * the orchestrator with metadata.isGreeting) was added below it, on the live
 * socket path and again after a reload.
 */

async function initialize(chat: { initialize: () => Promise<void> }) {
  const done = chat.initialize();
  await vi.advanceTimersByTimeAsync(200);
  await done;
}

const LOCAL_GREETING = "Hello! How can we help you today?";
const serverGreeting = {
  id: "g1",
  type: "BotAgent",
  content: "Hello! How can I help you today?",
  createdAt: "2026-10-27T10:00:01.000Z",
  metadata: { isGreeting: true },
};
const customerMessage = {
  id: "u1",
  type: "Customer",
  content: "Where is my order?",
  createdAt: "2026-10-27T10:00:03.000Z",
};
const reply = {
  id: "a1",
  type: "BotAgent",
  content: "Let me check.",
  createdAt: "2026-10-27T10:00:05.000Z",
};

describe("useChat greeting", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T10:00:00.000Z"));
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.spyOn(console, "error").mockImplementation(() => {});
    sessionStorage.clear();
    mockFetch({
      "publicConversations.create": () => ({
        data: { id: "conv-1", nonce: "n1", createdAt: "2026-10-27T10:00:00.000Z" },
      }),
      "publicConversations.sendMessage": () => ({
        data: { messageId: "u1", nonce: "n2", createdAt: customerMessage.createdAt },
      }),
      "publicConversations.getMessages": () => ({
        data: { nonce: "n3", messages: [serverGreeting, customerMessage, reply] },
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows the local greeting until the server's greeting replaces it", async () => {
    const { chat, unmount } = await mountChat();
    await initialize(chat);
    expect(chat.messages.value.map((m) => m.content)).toEqual([LOCAL_GREETING]);

    await chat.sendMessage(customerMessage.content);
    FakeWebSocket.instances[0].receive({
      type: "message",
      data: { ...serverGreeting, timestamp: serverGreeting.createdAt },
    });
    FakeWebSocket.instances[0].receive({
      type: "message",
      data: { ...reply, timestamp: reply.createdAt },
    });
    // Polling then returns the same messages; nothing is duplicated.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(chat.messages.value.map((m) => m.content)).toEqual([
      serverGreeting.content,
      customerMessage.content,
      reply.content,
    ]);
    expect(chat.messages.value.filter((m) => m.isGreeting)).toHaveLength(1);
    unmount();
  });

  it("shows only the server's greeting, first, after a reload", async () => {
    markInteraction();
    sessionStorage.setItem("hay-conversation-id", "conv-1");
    vi.mocked(getKeypair).mockResolvedValue({
      conversationId: "conv-1",
      createdAt: new Date(),
      privateKey: {} as CryptoKey,
      publicKey: {} as CryptoKey,
      publicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
    });

    const { chat, unmount } = await mountChat();
    await initialize(chat);

    expect(chat.messages.value.map((m) => m.content)).toEqual([
      serverGreeting.content,
      customerMessage.content,
      reply.content,
    ]);
    expect(chat.messages.value[0].isGreeting).toBe(true);
    unmount();
  });
});
