// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  sendMessage: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    conversations: {
      create: { mutate: api.create },
      sendMessage: { mutate: api.sendMessage },
      get: { query: api.get },
      update: { mutate: api.update },
    },
  },
}));

const socket = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    handlers,
    connect: vi.fn(),
    send: vi.fn(),
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
  };
});
const useWebSocketMock = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: (options?: unknown) => {
    useWebSocketMock(options);
    return { connect: socket.connect, send: socket.send, on: socket.on };
  },
}));

import { useSetupTestChat } from "../../composables/useSetupTestChat";

function mountChat() {
  let chat!: ReturnType<typeof useSetupTestChat>;
  const wrapper = mount(
    defineComponent({
      setup() {
        chat = useSetupTestChat();
        return () => h("div");
      },
    }),
  );
  return { chat, wrapper };
}

const botReply = (id: string, content: string) => ({
  conversationId: "c1",
  data: { id, content, type: "BotAgent", timestamp: "2026-11-05T12:00:00.000Z" },
});

describe("useSetupTestChat", () => {
  it("only listens on the shared socket, so leaving setup does not close it for other pages", () => {
    mountChat();
    expect(useWebSocketMock).toHaveBeenCalledWith({ disconnectOnUnmount: false });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    socket.handlers.clear();
    api.create.mockResolvedValue({ id: "c1" });
    api.sendMessage.mockResolvedValue({ id: "m1" });
    api.update.mockResolvedValue({});
    api.get.mockResolvedValue({ messages: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("starts a dry-run playground conversation on the first question only", async () => {
    const { chat } = mountChat();
    expect(api.create).not.toHaveBeenCalled();

    await chat.send("Where is my order?");
    expect(api.create).toHaveBeenCalledWith({
      metadata: { sourceId: "playground", dryRun: true },
      status: "open",
    });
    expect(api.sendMessage).toHaveBeenCalledWith({
      conversationId: "c1",
      content: "Where is my order?",
      role: "user",
    });
    expect(socket.send).toHaveBeenCalledWith({ type: "subscribe", conversationId: "c1" });

    socket.handlers.get("message")?.(botReply("b1", "It shipped yesterday."));
    await chat.send("And the refund?");
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("shows the reply from the socket and stops waiting", async () => {
    const { chat } = mountChat();
    await chat.send("What is your return policy?");
    expect(chat.awaitingReply.value).toBe(true);
    expect(chat.typing.value).toBe(true);

    socket.handlers.get("message")?.(botReply("b1", "30 days."));
    expect(chat.awaitingReply.value).toBe(false);
    expect(chat.typing.value).toBe(false);
    expect(chat.entries.value.some((e) => e.message.id === "b1")).toBe(true);
    expect(chat.entries.value[0].message.deliveryState).toBe("sent");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows the greeting first and keeps waiting for the real reply", async () => {
    const greeting = {
      id: "g1",
      content: "Hi, how can I help?",
      type: "BotAgent",
      created_at: "2026-11-05T12:00:00.000Z",
    };
    api.get.mockResolvedValue({ messages: [greeting] });
    const { chat } = mountChat();
    await chat.send("How much is it?");

    expect(chat.entries.value.map((e) => e.message.id)[0]).toBe("g1");
    expect(chat.awaitingReply.value).toBe(true);

    // The poll and the socket can both report the greeting again; it is not the answer.
    await vi.advanceTimersByTimeAsync(4000);
    socket.handlers.get("message")?.(botReply("g1", "Hi, how can I help?"));
    expect(chat.awaitingReply.value).toBe(true);
    expect(chat.entries.value.find((e) => e.message.id === "g1")?.sources).toEqual([]);

    socket.handlers.get("message")?.(botReply("b1", "From 50 a month."));
    expect(chat.awaitingReply.value).toBe(false);
    expect(chat.entries.value.some((e) => e.message.id === "b1")).toBe(true);
  });

  it("names no source on a handed-off reply, and asks the next question in a new conversation", async () => {
    const { chat } = mountChat();
    await chat.send("Is there a free trial?");
    api.create.mockResolvedValue({ id: "conv-2" });

    const handoff = botReply("h1", "I've passed this to the team.");
    handoff.data.metadata = { handoffType: "available" } as never;
    socket.handlers.get("message")?.(handoff);

    const reply = chat.entries.value.find((e) => e.message.id === "h1");
    expect(reply?.handedOff).toBe(true);
    expect(reply?.sources).toEqual([]);

    await chat.send("Do you offer refunds?");
    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "closed" } }),
    );
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(api.sendMessage.mock.calls.at(-1)?.[0].conversationId).toBe("conv-2");
  });

  it("does not greet twice when a new conversation starts", async () => {
    const greeting = (id: string) => ({
      id,
      content: "Hi",
      type: "BotAgent",
      metadata: { isGreeting: true },
      created_at: "2026-11-05T12:00:00.000Z",
    });
    api.get.mockResolvedValue({ messages: [greeting("g1")] });
    const { chat } = mountChat();
    await chat.send("One?");

    const handoff = botReply("h1", "Passed on.");
    handoff.data.metadata = { handoffType: "available" } as never;
    socket.handlers.get("message")?.(handoff);

    api.create.mockResolvedValue({ id: "conv-2" });
    api.get.mockResolvedValue({ messages: [greeting("g2")] });
    await chat.send("Two?");

    const ids = chat.entries.value.map((e) => e.message.id);
    expect(ids).toContain("g1");
    expect(ids).not.toContain("g2");
  });

  it("shows the closest retrieved document as each reply's source", async () => {
    const message = (id: string, type: string, at: string, metadata?: object) => ({
      id,
      content: id,
      type,
      created_at: `2026-11-05T12:00:${at}.000Z`,
      metadata,
    });
    const greeting = message("g1", "BotAgent", "00");
    const trial = { documentId: "d1", documentTitle: "Free trial" };
    api.get.mockResolvedValueOnce({ messages: [greeting] }).mockResolvedValue({
      messages: [
        greeting,
        message("doc1", "Document", "05", trial),
        message("r1", "BotAgent", "10"),
        message("doc2", "Document", "15", { documentId: "d1", documentTitle: "Free trial" }),
        message("doc3", "Document", "16", { documentId: "d2", documentTitle: "Pricing" }),
        message("r2", "BotAgent", "20"),
      ],
    });
    const { chat } = mountChat();
    await chat.send("Can I try it first?");

    // The reply comes over the socket before the documents have been fetched.
    socket.handlers.get("message")?.(botReply("r1", "Yes."));
    await flushPromises();

    const sourcesOf = (id: string) =>
      chat.entries.value.find((e) => e.message.id === id)?.sources.map((s) => s.title);
    expect(sourcesOf("g1")).toEqual([]);
    expect(sourcesOf("r1")).toEqual(["Free trial"]);
    // The same page can answer a later question too; it isn't dropped for having appeared before.
    expect(sourcesOf("r2")).toEqual(["Free trial"]);
  });

  it("ignores messages from other conversations", async () => {
    const { chat } = mountChat();
    await chat.send("Hi");
    socket.handlers.get("message")?.({ ...botReply("x", "not ours"), conversationId: "other" });
    expect(chat.entries.value.map((e) => e.message.id)).toEqual(["m1"]);
    expect(chat.awaitingReply.value).toBe(true);
  });

  it("falls back to polling when the socket missed the reply", async () => {
    const { chat } = mountChat();
    await chat.send("Hi");
    api.get.mockResolvedValue({
      messages: [
        {
          id: "m1",
          content: "Hi",
          type: "Customer",
          created_at: "2026-11-05T12:00:00.000Z",
          status: "approved",
        },
        {
          id: "b1",
          content: "Hello!",
          type: "BotAgent",
          created_at: "2026-11-05T12:00:02.000Z",
          status: "approved",
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(chat.awaitingReply.value).toBe(false);
    expect(chat.entries.value.map((e) => e.message.content)).toEqual(["Hi", "Hello!"]);
  });

  it("reports a missing reply after the deadline, and retry asks again", async () => {
    const { chat } = mountChat();
    await chat.send("Hi");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(chat.error.value).toBe("reply");
    expect(chat.awaitingReply.value).toBe(false);

    await chat.retry();
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(chat.error.value).toBeNull();
  });

  it("reports when the test chat can't start", async () => {
    api.create.mockRejectedValueOnce(new Error("offline"));
    const { chat } = mountChat();
    await chat.send("Hi");
    expect(chat.error.value).toBe("start");
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(chat.entries.value).toEqual([]);
  });

  it("marks a message that failed to send, and retrying resends it", async () => {
    api.sendMessage.mockRejectedValueOnce(new Error("offline"));
    const { chat } = mountChat();
    await chat.send("Hi");
    expect(chat.entries.value[0].message.deliveryState).toBe("failed");
    expect(chat.awaitingReply.value).toBe(false);

    await chat.retry(chat.entries.value[0].message.id);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(chat.entries.value).toHaveLength(1);
  });

  it("closes the throwaway conversation and clears timers on unmount", async () => {
    const { chat, wrapper } = mountChat();
    await chat.send("Hi");
    wrapper.unmount();
    await flushPromises();
    expect(api.update).toHaveBeenCalledWith({ id: "c1", data: { status: "closed" } });
    expect(vi.getTimerCount()).toBe(0);
    expect(socket.handlers.size).toBe(0);
  });
});
