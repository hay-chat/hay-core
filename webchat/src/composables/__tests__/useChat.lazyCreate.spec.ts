import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * D9-4: the conversation is created by the shopper's first message, not when
 * the widget opens. Opening used to create a database row (and a customer) for
 * every visitor who clicked the button, which bots could farm for free.
 */

const LOCAL_GREETING = "Hello! How can we help you today?";

async function settle() {
  await vi.advanceTimersByTimeAsync(200);
}

const calls = (fetchMock: ReturnType<typeof mockFetch>, name: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(name));

describe("useChat creates the conversation on the first message", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mockFetch>;
  let created = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.spyOn(console, "error").mockImplementation(() => {});
    created = 0;
    fetchMock = mockFetch({
      "publicConversations.create": () => {
        created++;
        return {
          data: { id: `conv-${created}`, nonce: "n1", createdAt: "2026-10-27T10:00:00.000Z" },
        };
      },
      "publicConversations.sendMessage": () => ({
        data: { messageId: "u1", nonce: "n2", createdAt: "2026-10-27T10:00:03.000Z" },
      }),
      "publicConversations.getMessages": () => ({ data: { nonce: "n3", messages: [] } }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("opening the widget shows the greeting without creating anything or connecting", async () => {
    const { chat, unmount } = await mountChat();
    chat.toggleChat();
    await settle();

    expect(chat.isInitialized.value).toBe(true);
    expect(chat.messages.value.map((m) => m.content)).toEqual([LOCAL_GREETING]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);

    // Closing and reopening still creates nothing.
    chat.toggleChat();
    chat.toggleChat();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });

  it("the first message creates the conversation, sends to it and connects the socket", async () => {
    const onConversationStarted = vi.fn();
    const { chat, unmount } = await mountChat({ onConversationStarted });
    chat.toggleChat();
    await settle();

    await chat.sendMessage("Do you ship to Lisbon?");
    await settle();

    expect(calls(fetchMock, "publicConversations.create")).toHaveLength(1);
    const send = calls(fetchMock, "publicConversations.sendMessage");
    expect(send).toHaveLength(1);
    expect(JSON.parse(String(send[0][1]?.body)).conversationId).toBe("conv-1");
    expect(onConversationStarted).toHaveBeenCalledWith({ id: "conv-1" });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(sessionStorage.getItem("hay-conversation-id")).toBe("conv-1");
    expect(chat.messages.value.map((m) => m.content)).toEqual([
      LOCAL_GREETING,
      "Do you ship to Lisbon?",
    ]);
    unmount();
  });

  it("waits for an async onConversationStarted before sending the first message", async () => {
    let release!: () => void;
    const onConversationStarted = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { chat, unmount } = await mountChat({ onConversationStarted });

    const sending = chat.sendMessage("hi");
    await settle();
    expect(calls(fetchMock, "publicConversations.sendMessage")).toHaveLength(0);
    // The bubble shows right away, before the conversation exists.
    expect(chat.messages.value.some((m) => m.content === "hi")).toBe(true);

    release();
    await sending;
    expect(calls(fetchMock, "publicConversations.sendMessage")).toHaveLength(1);
    unmount();
  });

  it("a second message sent while the conversation is being created goes to the same one", async () => {
    const { chat, unmount } = await mountChat();
    const first = chat.sendMessage("one");
    const second = chat.sendMessage("two");
    await Promise.all([first, second]);
    await settle();

    expect(created).toBe(1);
    const bodies = calls(fetchMock, "publicConversations.sendMessage").map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies.map((b) => [b.conversationId, b.content])).toEqual([
      ["conv-1", "one"],
      ["conv-1", "two"],
    ]);
    unmount();
  });

  it("starting over after a closed conversation creates the new one on the next message", async () => {
    const { chat, unmount } = await mountChat();
    await chat.sendMessage("first");
    chat.isConversationClosed.value = true;

    await chat.startNewConversation();
    await settle();
    expect(created).toBe(1);
    expect(chat.messages.value.map((m) => m.content)).toEqual([LOCAL_GREETING]);

    await chat.sendMessage("second");
    expect(created).toBe(2);
    const send = calls(fetchMock, "publicConversations.sendMessage");
    expect(JSON.parse(String(send[1][1]?.body)).conversationId).toBe("conv-2");
    unmount();
  });
});
