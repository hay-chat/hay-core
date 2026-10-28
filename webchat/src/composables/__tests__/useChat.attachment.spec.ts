import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * D8-9: the shopper sends a photo or PDF from the paperclip. The file goes
 * with the typed caption in one call; refused files come back as a notice.
 */

const created = () => ({
  data: { id: "conv-1", nonce: "n1", createdAt: "2026-10-27T10:00:00.000Z" },
});

// FileReader and ensureConversation run on timers, which are faked here.
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(500);
  return promise;
}

async function initialize(chat: { initialize: () => Promise<void> }) {
  const done = chat.initialize();
  await vi.advanceTimersByTimeAsync(200);
  await done;
}

describe("useChat attachments", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.spyOn(console, "error").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends the file with its caption and keeps the bubble, linked to the server message", async () => {
    let body: Record<string, unknown> = {};
    mockFetch({
      "publicConversations.create": created,
      "publicConversations.sendAttachment": (sent) => {
        body = sent;
        return {
          data: {
            messageId: "m-1",
            nonce: "n2",
            createdAt: "2026-10-27T10:00:03.000Z",
            attachment: {
              id: "u1",
              name: "broken.jpg",
              url: "https://api.example.test/v1/media/u1?expires=1&sig=s",
              type: "image/jpeg",
              size: 3,
            },
            error: null,
          },
        };
      },
    });
    const { chat, unmount } = await mountChat();
    await initialize(chat);

    const file = new File(["abc"], "broken.jpg", { type: "image/jpeg" });
    await settle(chat.sendAttachment(file, " It arrived broken "));

    expect(body).toMatchObject({
      conversationId: "conv-1",
      data: btoa("abc"),
      mimeType: "image/jpeg",
      filename: "broken.jpg",
      caption: "It arrived broken",
    });
    const bubble = chat.messages.value.find((m) => m.sender === "user");
    expect(bubble?.content).toBe("It arrived broken");
    expect(bubble?.metadata).toEqual({ serverId: "m-1" });
    // The photo keeps showing from the shopper's own copy.
    expect(bubble?.attachments?.[0]).toMatchObject({ id: "u1", url: "blob:preview" });
    expect(chat.sendFailure.value).toBeNull();
    unmount();
  });

  it("refuses files over 10 MB and other types before uploading", async () => {
    const fetchMock = mockFetch({ "publicConversations.create": created });
    const { chat, unmount } = await mountChat();
    await initialize(chat);

    const big = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    await chat.sendAttachment(big, "caption");
    expect(chat.sendFailure.value).toEqual({ reason: "fileTooLarge", text: "caption" });

    await chat.sendAttachment(new File(["x"], "clip.mp4", { type: "video/mp4" }));
    expect(chat.sendFailure.value).toEqual({ reason: "fileType", text: "" });

    const uploads = fetchMock.mock.calls.filter(([url]) => String(url).includes("sendAttachment"));
    expect(uploads).toHaveLength(0);
    expect(chat.messages.value.some((m) => m.sender === "user")).toBe(false);
    unmount();
  });

  it("takes the bubble back and reports a file the server refused", async () => {
    mockFetch({
      "publicConversations.create": created,
      "publicConversations.sendAttachment": () => ({ status: 400, error: { message: "bad" } }),
    });
    const { chat, unmount } = await mountChat();
    await initialize(chat);

    await settle(
      chat.sendAttachment(new File(["%PDF"], "invoice.pdf", { type: "application/pdf" }), ""),
    );

    expect(chat.sendFailure.value).toEqual({ reason: "fileFailed", text: "" });
    expect(chat.messages.value.some((m) => m.sender === "user")).toBe(false);
    unmount();
  });
});
