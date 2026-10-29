import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "vue";
import { useWebSocket } from "../useWebSocket";

/**
 * The widget's socket is receive-only (plus identify and typing): messages go
 * out over HTTP (publicConversations.sendMessage) and history comes from
 * publicConversations.getMessages. The server dropped its load_history
 * handler, so the client must not offer a socket send or history path.
 */

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function setup() {
  let result!: ReturnType<typeof useWebSocket>;
  const app = createApp({
    setup() {
      result = useWebSocket("https://api.example.test", "org-1");
      return () => null;
    },
  });
  app.mount(document.createElement("div"));
  return { ws: result, app };
}

describe("useWebSocket", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("exposes no socket send or history-loading path", () => {
    const { ws, app } = setup();
    expect(ws).not.toHaveProperty("sendMessage");
    expect(ws).not.toHaveProperty("loadHistory");
    app.unmount();
  });

  it("only ever sends identify and typing frames", () => {
    const { ws, app } = setup();
    ws.connect();
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();

    ws.identify("anon_1", "conv-1");
    ws.sendTypingIndicator(true);

    const types = socket.sent.map((frame) => JSON.parse(frame).type);
    expect(types).toEqual(["identify", "typing"]);
    app.unmount();
  });

  it("sends page tools with identify and answers tool_call with tool_result", () => {
    const { ws, app } = setup();
    ws.connect();
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    const tools = [{ name: "navigate", description: "Go", inputSchema: { type: "object" } }];
    ws.identify("anon_1", "conv-1", tools);
    expect(JSON.parse(socket.sent[0]).tools).toEqual(tools);

    const calls: unknown[] = [];
    ws.setToolCallHandler((call) => calls.push(call));
    socket.receive({ type: "tool_call", callId: "c1", name: "navigate", args: { path: "/x" } });
    socket.receive({ type: "tool_call", name: "no-call-id" });
    expect(calls).toEqual([{ callId: "c1", name: "navigate", args: { path: "/x" } }]);

    ws.sendToolResult("c1", { result: "ok" });
    ws.sendTools([]);
    expect(socket.sent.slice(1).map((f) => JSON.parse(f))).toEqual([
      { type: "tool_result", callId: "c1", result: "ok" },
      { type: "register_tools", tools: [] },
    ]);
    app.unmount();
  });

  it("appends agent messages and ignores customer echoes", () => {
    const { ws, app } = setup();
    ws.connect();
    const socket = FakeWebSocket.instances[0];

    socket.receive({
      type: "message",
      data: { id: "m1", type: "BotAgent", content: "Hi there", timestamp: "2026-10-27T10:00:00Z" },
    });
    socket.receive({
      type: "message",
      data: { id: "m2", type: "Customer", content: "hello", timestamp: "2026-10-27T10:00:01Z" },
    });
    // A duplicate delivery of the same id is dropped.
    socket.receive({
      type: "message",
      data: { id: "m1", type: "BotAgent", content: "Hi there", timestamp: "2026-10-27T10:00:00Z" },
    });

    expect(ws.messages.value.map((m) => m.id)).toEqual(["m1"]);
    expect(ws.messages.value[0].sender).toBe("agent");
    app.unmount();
  });

  it("adds a team member's join line live, with its metadata", () => {
    const { ws, app } = setup();
    ws.connect();
    const socket = FakeWebSocket.instances[0];

    socket.receive({
      type: "message",
      data: {
        id: "m1",
        type: "System",
        content: "",
        timestamp: "2026-10-27T10:00:00Z",
        metadata: { systemEvent: "agent_joined", agentFirstName: "Marina" },
      },
    });

    expect(ws.messages.value).toHaveLength(1);
    expect(ws.messages.value[0]).toMatchObject({
      agentType: "System",
      content: "",
      metadata: { systemEvent: "agent_joined", agentFirstName: "Marina" },
    });
    app.unmount();
  });

  it("ignores a stray history frame instead of replacing the conversation", () => {
    const { ws, app } = setup();
    ws.connect();
    const socket = FakeWebSocket.instances[0];
    socket.receive({
      type: "message",
      data: { id: "m1", type: "BotAgent", content: "Hi", timestamp: "2026-10-27T10:00:00Z" },
    });

    socket.receive({ type: "history", messages: [] });

    expect(ws.messages.value.map((m) => m.id)).toEqual(["m1"]);
    app.unmount();
  });
});
