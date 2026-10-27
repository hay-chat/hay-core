import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * When the server refuses the shopper's message (403 website not allowed,
 * 429 rate limited, 400 too long) the message used to vanish. Now the widget
 * reports a short failure and hands the text back for a retry.
 */

const created = () => ({
  data: { id: "conv-1", nonce: "n1", createdAt: "2026-10-27T10:00:00.000Z" },
});
const sent = () => ({
  data: { messageId: "u1", nonce: "n2", createdAt: "2026-10-27T10:00:03.000Z" },
});

async function initialize(chat: { initialize: () => Promise<void> }) {
  const done = chat.initialize();
  await vi.advanceTimersByTimeAsync(200);
  await done;
}

describe("useChat refused sends", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.each([
    [403, "website not allowed"],
    [429, "rate limited"],
  ])("reports a refused conversation create (%i, %s) and keeps the text", async (status) => {
    const fetchMock = mockFetch({
      "publicConversations.create": () => ({ status, error: { message: "internal reason" } }),
      "publicConversations.sendMessage": sent,
    });
    const { chat, unmount } = await mountChat();
    await initialize(chat);

    await expect(chat.sendMessage("Do you ship to Lisbon?")).resolves.toBeUndefined();

    expect(chat.sendFailure.value).toEqual({
      reason: "sendFailed",
      text: "Do you ship to Lisbon?",
    });
    expect(chat.messages.value.some((m) => m.sender === "user")).toBe(false);
    const sendCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("sendMessage"));
    expect(sendCalls).toHaveLength(0);
    unmount();
  });

  it("says the message is too long when sendMessage is refused with 400", async () => {
    mockFetch({
      "publicConversations.create": created,
      "publicConversations.sendMessage": () => ({ status: 400, error: { message: "too_big" } }),
    });
    const { chat, unmount } = await mountChat();
    await initialize(chat);

    await chat.sendMessage("a very long message");

    expect(chat.sendFailure.value).toEqual({ reason: "messageTooLong", text: "a very long message" });
    // The optimistic bubble is taken back; the greeting stays.
    expect(chat.messages.value.map((m) => m.id)).toEqual(["greeting"]);
    unmount();
  });

  it("reports a rate-limited sendMessage (429) without queueing a retry", async () => {
    const fetchMock = mockFetch({
      "publicConversations.create": created,
      "publicConversations.sendMessage": () => ({ status: 429 }),
    });
    const { chat, unmount } = await mountChat();
    await initialize(chat);

    await chat.sendMessage("hello?");
    expect(chat.sendFailure.value?.reason).toBe("sendFailed");

    // The background retry loop must not resend a refused message.
    await vi.advanceTimersByTimeAsync(20_000);
    const sendCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("sendMessage"));
    expect(sendCalls).toHaveLength(1);
    unmount();
  });

  it("clears the failure once a retry goes through", async () => {
    let refuse = true;
    mockFetch({
      "publicConversations.create": () => (refuse ? { status: 429 } : created()),
      "publicConversations.sendMessage": sent,
    });
    const { chat, unmount } = await mountChat();
    await initialize(chat);

    await chat.sendMessage("hi");
    expect(chat.sendFailure.value).not.toBeNull();

    refuse = false;
    await chat.sendMessage("hi");
    expect(chat.sendFailure.value).toBeNull();
    expect(chat.messages.value.map((m) => m.content)).toContain("hi");
    unmount();
  });

  it("keeps queueing on server errors (5xx), which are transient", async () => {
    mockFetch({
      "publicConversations.create": created,
      "publicConversations.sendMessage": () => ({ status: 503 }),
    });
    const { chat, unmount } = await mountChat();
    await initialize(chat);

    await expect(chat.sendMessage("hi")).rejects.toThrow();
    expect(chat.sendFailure.value).toBeNull();
    const pending = chat.messages.value.find((m) => m.sender === "user");
    expect(pending?.metadata).toMatchObject({ pending: true, error: true });
    unmount();
  });
});
