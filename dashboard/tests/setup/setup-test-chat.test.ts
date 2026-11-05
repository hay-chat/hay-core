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
vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({ connect: socket.connect, send: socket.send, on: socket.on }),
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

  it("shows the reply from the socket with the asked row's sources, and stops waiting", async () => {
    const { chat } = mountChat();
    const sources = [{ documentId: "d1", title: "Returns page" }];
    await chat.send("What is your return policy?", sources);
    expect(chat.awaitingReply.value).toBe(true);
    expect(chat.typing.value).toBe(true);

    socket.handlers.get("message")?.(botReply("b1", "30 days."));
    expect(chat.awaitingReply.value).toBe(false);
    expect(chat.typing.value).toBe(false);
    const reply = chat.entries.value.find((e) => e.message.id === "b1");
    expect(reply?.sources).toEqual(sources);
    expect(chat.entries.value[0].message.deliveryState).toBe("sent");
    expect(vi.getTimerCount()).toBe(0);
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
