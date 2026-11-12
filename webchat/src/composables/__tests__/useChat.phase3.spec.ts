import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { FakeWebSocket, mockFetch, mountChat } from "./chatHarness";

vi.mock("../useDPoP", async () => (await import("./chatHarness")).dpopMock());

/**
 * C3 in the widget: every visitor message carries a clientMessageId so the
 * server's message_ack finds its bubble; message_read marks it seen;
 * agent_activity drives the progress line and the done label; thumbs go to
 * rateMessage with the same nonce handling as submitCsat.
 */

const created = () => ({
  data: { id: "conv-1", nonce: "n1", createdAt: "2026-10-27T10:00:00.000Z" },
});
const sent = () => ({
  data: { messageId: "m-1", nonce: "n2", createdAt: "2026-10-27T10:00:01.000Z" },
});

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(500);
  return promise;
}

describe("useChat conversation events (C3)", () => {
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

  async function startConversation() {
    let body: Record<string, unknown> = {};
    const fetchMock = mockFetch({
      "publicConversations.create": created,
      "publicConversations.sendMessage": (input) => {
        body = input;
        return sent();
      },
    });
    const mounted = await mountChat();
    await settle(mounted.chat.sendMessage("Where is my order?"));
    const socket = FakeWebSocket.instances[0];
    return { ...mounted, socket, body: () => body, fetchMock };
  }

  it("sends a clientMessageId and moves the bubble from ✓ to ✓✓ on acks", async () => {
    const { chat, socket, body, unmount } = await startConversation();
    const bubble = () => chat.messages.value.find((m) => m.sender === "user")!;

    expect(body().clientMessageId).toBe(bubble().metadata?.clientMessageId);
    expect(body().clientMessageId).toMatch(/^temp-/);

    const clientMessageId = body().clientMessageId as string;
    socket.receive({ type: "message_ack", messageId: "m-1", clientMessageId, status: "received" });
    expect(bubble().metadata).toMatchObject({ serverId: "m-1", delivery: "received" });

    socket.receive({ type: "message_ack", messageId: "m-1", status: "delivered" });
    expect(bubble().metadata?.delivery).toBe("delivered");

    // A late "received" never steps back.
    socket.receive({ type: "message_ack", messageId: "m-1", clientMessageId, status: "received" });
    expect(bubble().metadata?.delivery).toBe("delivered");

    socket.receive({ type: "message_read", messageId: "m-1", readAt: "2026-10-27T10:01:00Z" });
    expect(chat.readMessageId.value).toBe("m-1");
    unmount();
  });

  it("ignores malformed events", async () => {
    const { chat, socket, unmount } = await startConversation();
    socket.receive({ type: "message_ack", messageId: "m-1", status: "lost" });
    socket.receive({ type: "message_read", messageId: "m-1" });
    socket.receive({ type: "agent_activity", state: "maybe", label: "x", doneLabel: "y" });
    expect(chat.messages.value.find((m) => m.sender === "user")?.metadata?.delivery).toBe(
      undefined,
    );
    expect(chat.readMessageId.value).toBeNull();
    expect(chat.activity.value).toBeNull();
    unmount();
  });

  it("shows the tool run, then puts its done label on the reply", async () => {
    const { chat, socket, unmount } = await startConversation();
    const run = { toolName: "shop:order", label: "Checking #1043…", doneLabel: "Checked #1043" };

    socket.receive({ type: "agent_activity", state: "start", ...run });
    expect(chat.activity.value).toEqual({
      running: true,
      label: "Checking #1043…",
      doneLabel: "Checked #1043",
    });
    socket.receive({ type: "agent_activity", state: "end", ...run });
    expect(chat.activity.value?.running).toBe(false);

    socket.receive({
      type: "message",
      data: { id: "b-1", type: "BotAgent", content: "It ships today.", timestamp: Date.now() },
    });
    await nextTick();
    expect(chat.doneLabels.value).toEqual({ "b-1": "Checked #1043" });
    expect(chat.activity.value).toBeNull();
    unmount();
  });

  it("rates an answer, retrying once on an expired nonce", async () => {
    const { chat, fetchMock, unmount } = await startConversation();
    const ratings: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      ratings.push(JSON.parse(String(init?.body)));
      const data =
        ratings.length === 1
          ? { saved: false, nonce: "fresh", error: "NONCE_EXPIRED" }
          : { saved: true, nonce: "n3", error: null };
      expect(url).toContain("publicConversations.rateMessage");
      return { ok: true, status: 200, json: async () => ({ result: { data } }) } as Response;
    });

    expect(await chat.rateMessage("b-1", "up")).toBe(true);
    expect(ratings).toHaveLength(2);
    expect(ratings[1]).toMatchObject({ conversationId: "conv-1", messageId: "b-1", rating: "up" });
    expect(chat.ratings.value).toEqual({ "b-1": "up" });
    unmount();
  });

  it("opens an earlier conversation from the home list and follows it on the socket", async () => {
    const { chat, socket, fetchMock, unmount } = await startConversation();
    const dpop = await import("../useDPoP");
    vi.mocked(dpop.getKeypair).mockResolvedValueOnce({
      conversationId: "conv-old",
      privateKey: {} as CryptoKey,
      publicKey: {} as CryptoKey,
      publicJwk: { kty: "EC" },
      createdAt: new Date(),
    });
    let asked: Record<string, unknown> = {};
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      asked = JSON.parse(String(init?.body));
      const data = {
        nonce: "n9",
        status: "closed",
        isClosed: true,
        messages: [
          {
            id: "o-1",
            type: "Customer",
            content: "Old question",
            createdAt: "2026-10-01T10:00:00Z",
          },
          { id: "o-2", type: "BotAgent", content: "Old answer", createdAt: "2026-10-01T10:00:05Z" },
        ],
      };
      return { ok: true, status: 200, json: async () => ({ result: { data } }) } as Response;
    });
    const sentFrames: string[] = [];
    vi.spyOn(socket, "send").mockImplementation(((frame: string) => {
      sentFrames.push(frame);
    }) as () => void);

    expect(await chat.openConversation("conv-old")).toBe(true);
    expect(asked.conversationId).toBe("conv-old");
    expect(chat.conversationId.value).toBe("conv-old");
    expect(chat.isConversationClosed.value).toBe(true);
    expect(chat.messages.value.map((m) => m.content)).toEqual([
      "Hello! How can we help you today?",
      "Old question",
      "Old answer",
    ]);
    expect(sentFrames.map((f) => JSON.parse(f))).toContainEqual(
      expect.objectContaining({ type: "identify", conversationId: "conv-old" }),
    );
    unmount();
  });

  it("takes the thumb back when the rating is not saved", async () => {
    const { chat, fetchMock, unmount } = await startConversation();
    fetchMock.mockImplementation(async () => ({ ok: false, status: 404 }) as Response);
    expect(await chat.rateMessage("b-1", "down")).toBe(false);
    expect(chat.ratings.value).toEqual({});
    unmount();
  });
});
