import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { EventEmitter } from "events";

/**
 * Every write a public (unauthenticated) WebSocket client makes must go through
 * the same DPoP gate as the HTTP widget API. Guards "GAP A": a client opening
 * `/ws?org=<id>` could `identify` (creating a conversation) and then send
 * `message` frames that reached the AI with no keypair, nonce or proof.
 */

jest.mock("@server/config/env", () => ({ config: { jwt: { secret: "ws-test-secret" } } }));
const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/services/redis.service", () => ({
  redisService: { subscribe: jest.fn(async () => undefined) },
}));

jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

const mockConversationRepo = {
  findById: jest.fn<(id: string) => Promise<unknown>>(),
  create: jest.fn<(data: Record<string, unknown>) => Promise<unknown>>(),
};
jest.mock("@server/repositories/conversation.repository", () => ({
  conversationRepository: mockConversationRepo,
}));

const mockVerifyDPoP =
  jest.fn<
    (
      conversationId: string,
      proof: string,
      method: string,
      url: string,
    ) => Promise<{ success: boolean; newNonce?: string; error?: string }>
  >();
jest.mock("@server/routes/v1/public-conversations", () => ({
  verifyDPoPForRequest: mockVerifyDPoP,
}));

import { WebSocketService } from "@server/services/websocket.service";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONV_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CONV_ID = "33333333-3333-4333-8333-333333333333";

class FakeSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sent: Record<string, unknown>[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {}
  last(): Record<string, unknown> | undefined {
    return this.sent[this.sent.length - 1];
  }
}

interface ServiceInternals {
  handleConnection(ws: unknown, req: unknown): void;
  handleMessage(clientId: string, data: string): Promise<void>;
  conversationClients: Map<string, Set<string>>;
}

function connect(service: WebSocketService, query = `org=${ORG_ID}`) {
  const internals = service as unknown as ServiceInternals;
  const ws = new FakeSocket();
  internals.handleConnection(ws, {
    url: `/ws?${query}`,
    headers: { host: "localhost:3001", "x-forwarded-for": "203.0.113.7" },
    socket: { remoteAddress: "10.0.0.1" },
  });
  const clientId = ws.sent[0].clientId as string;
  const send = (frame: Record<string, unknown>) =>
    internals.handleMessage(clientId, JSON.stringify(frame));
  return { ws, clientId, send, internals };
}

function webConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONV_ID,
    organization_id: ORG_ID,
    channel: "web",
    publicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
    addMessage: jest.fn(async (_input: Record<string, unknown>) => ({ id: "msg-1" })),
    ...overrides,
  };
}

const validFrame = {
  type: "message",
  content: "hello",
  proof: "proof.jwt",
  method: "POST",
  url: "http://localhost:3001/v1/publicConversations.sendMessage",
  conversationId: CONV_ID,
};

describe("WebSocket public writes require DPoP", () => {
  let service: WebSocketService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebSocketService();
    mockVerifyDPoP.mockResolvedValue({ success: true, newNonce: "nonce-2" });
  });

  it("identify without a conversationId does not create a conversation", async () => {
    const { ws, send } = connect(service);

    await send({ type: "identify", customerId: "visitor-1" });

    expect(mockConversationRepo.create).not.toHaveBeenCalled();
    expect(ws.last()).toMatchObject({ type: "error" });
  });

  it("rejects a message on a conversation that has no registered public key", async () => {
    const conversation = webConversation({ publicJwk: null });
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { ws, send } = connect(service);

    await send({ type: "identify", customerId: "visitor-1", conversationId: CONV_ID });
    await send({ type: "message", content: "hello" });

    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(ws.last()).toMatchObject({ type: "error" });
  });

  it("rejects a message without a DPoP proof", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { ws, send } = connect(service);

    await send({ type: "identify", customerId: "visitor-1", conversationId: CONV_ID });
    await send({ type: "message", content: "hello" });

    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(mockVerifyDPoP).not.toHaveBeenCalled();
    expect(ws.last()).toMatchObject({ type: "error" });
  });

  it("rejects a message on a non-web conversation", async () => {
    const conversation = webConversation({ channel: "whatsapp" });
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { send } = connect(service);

    await send({ type: "identify", customerId: "visitor-1", conversationId: CONV_ID });
    await send(validFrame);

    expect(conversation.addMessage).not.toHaveBeenCalled();
  });

  it("verifies the proof against the identified conversation, not a client-supplied id", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { ws, send } = connect(service);

    await send({ type: "identify", customerId: "visitor-1", conversationId: CONV_ID });
    // A valid proof for the attacker's own conversation must not write into CONV_ID.
    await send({ ...validFrame, conversationId: OTHER_CONV_ID });

    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(ws.last()).toMatchObject({ type: "error" });
  });

  it("returns the fresh nonce when the proof's nonce expired", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    mockVerifyDPoP.mockResolvedValue({
      success: false,
      error: "Invalid or expired nonce",
      newNonce: "fresh",
    });
    const { ws, send } = connect(service);

    await send({ type: "identify", customerId: "visitor-1", conversationId: CONV_ID });
    await send(validFrame);

    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(ws.last()).toEqual({ type: "error", error: "NONCE_EXPIRED", nonce: "fresh" });
  });

  it("accepts a message with a valid DPoP proof", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { ws, send } = connect(service);

    await send({ type: "identify", customerId: "visitor-1", conversationId: CONV_ID });
    await send(validFrame);

    expect(mockVerifyDPoP).toHaveBeenCalledWith(
      CONV_ID,
      validFrame.proof,
      validFrame.method,
      validFrame.url,
    );
    expect(conversation.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "hello" }),
    );
    expect(ws.last()).toEqual({ type: "message_sent", messageId: "msg-1", nonce: "nonce-2" });
  });

  it("does not let an unauthenticated client subscribe to an arbitrary conversation", async () => {
    const { send, clientId, internals } = connect(service);

    await send({ type: "subscribe", conversationId: OTHER_CONV_ID });

    expect(internals.conversationClients.get(OTHER_CONV_ID)?.has(clientId) ?? false).toBe(false);
  });
});
