import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * Regression: the first agent (hand-off) message rendered above the "Hello!"
 * greeting. The greeting was stamped with the browser clock and then swapped
 * out for the first agent message, which put that reply above the shopper's
 * own message. Here the browser clock runs two hours fast.
 */

// initialize() waits (by polling) for the socket to open; let fake time run.
async function initialize(chat: { initialize: () => Promise<void> }) {
  const done = chat.initialize();
  await vi.advanceTimersByTimeAsync(200);
  await done;
}

const SERVER_CREATED_AT = "2026-10-27T10:00:00.000Z";
const BROWSER_NOW = new Date("2026-10-27T12:00:00.000Z");

describe("useChat message ordering with a skewed browser clock", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BROWSER_NOW);
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch({
      "publicConversations.create": () => ({
        data: { id: "conv-1", nonce: "n1", createdAt: SERVER_CREATED_AT },
      }),
      "publicConversations.sendMessage": () => ({
        data: { messageId: "u1", nonce: "n2", createdAt: "2026-10-27T10:00:03.000Z" },
      }),
      "publicConversations.getMessages": () => ({
        data: {
          nonce: "n3",
          messages: [
            { id: "u1", type: "Customer", content: "Where is my order?", createdAt: "2026-10-27T10:00:03.000Z" },
            { id: "a1", type: "System", content: "Connecting you with the team.", createdAt: "2026-10-27T10:00:05.000Z" },
            { id: "a2", type: "HumanAgent", content: "Hi, Ana here.", createdAt: "2026-10-27T10:00:09.000Z" },
          ],
        },
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("keeps the greeting first and the hand-off reply after the shopper's message", async () => {
    const { chat, unmount } = await mountChat();
    await initialize(chat);

    const greeting = chat.messages.value[0];
    expect(greeting.isGreeting).toBe(true);
    // Stamped with the server's createdAt, not the fast browser clock.
    expect(greeting.timestamp).toBe(new Date(SERVER_CREATED_AT).getTime());

    await chat.sendMessage("Where is my order?");

    FakeWebSocket.instances[0].receive({
      type: "message",
      data: {
        id: "a1",
        type: "System",
        content: "Connecting you with the team.",
        timestamp: "2026-10-27T10:00:05.000Z",
      },
    });

    expect(chat.messages.value.map((m) => m.content)).toEqual([
      "Hello! How can we help you today?",
      "Where is my order?",
      "Connecting you with the team.",
    ]);
    unmount();
  });

  it("merges polled server messages in server order below the greeting", async () => {
    const { chat, unmount } = await mountChat();
    await initialize(chat);
    await chat.sendMessage("Where is my order?");

    // Socket delivers the later message first; polling then fills the gap.
    FakeWebSocket.instances[0].receive({
      type: "message",
      data: { id: "a2", type: "HumanAgent", content: "Hi, Ana here.", timestamp: "2026-10-27T10:00:09.000Z" },
    });
    // The 10-second polling fallback picks up the message the socket missed.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(chat.messages.value.map((m) => m.content)).toEqual([
      "Hello! How can we help you today?",
      "Where is my order?",
      "Connecting you with the team.",
      "Hi, Ana here.",
    ]);
    unmount();
  });
});
