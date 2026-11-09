import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { EventEmitter } from "events";

/**
 * Every write a public (unauthenticated) WebSocket client makes must go through
 * the same DPoP gate as the HTTP widget API. Guards "GAP A": a client opening
 * `/ws?org=<id>` could `identify` (creating a conversation) and then send
 * `message` frames that reached the AI with no keypair, nonce or proof.
 */

jest.mock("@server/config/env", () => ({
  config: {
    jwt: { secret: "ws-test-secret" },
    domain: { api: "api.example.test" },
    cors: { origin: ["https://app.example.test"] },
    server: { trustProxy: 1 },
  },
}));
const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/services/redis.service", () => ({
  redisService: { subscribe: jest.fn(async () => undefined), isConnected: () => false },
}));

const mockUserOrgFindOne = jest.fn<(options: unknown) => Promise<unknown>>();
const mockUserFindOne = jest.fn<(options: unknown) => Promise<unknown>>();
const mockUserFind = jest.fn<(options: unknown) => Promise<unknown[]>>();
const mockUserOrgFind = jest.fn<(options: unknown) => Promise<unknown[]>>();
const mockSessionFind = jest.fn<(options: unknown) => Promise<unknown[]>>();
jest.mock("@server/entities/user.entity", () => ({ User: class MockUser {} }));
jest.mock("@server/entities/session.entity", () => ({ Session: class MockSession {} }));
jest.mock("@server/entities/user-organization.entity", () => ({ UserOrganization: class {} }));
jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    isInitialized: false,
    getRepository: (entity: { name?: string }) => ({
      findOne: entity.name === "MockUser" ? mockUserFindOne : mockUserOrgFindOne,
      find:
        entity.name === "MockUser"
          ? mockUserFind
          : entity.name === "MockSession"
            ? mockSessionFind
            : mockUserOrgFind,
    }),
  },
}));

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
      target: unknown,
      options?: { checkNonce?: boolean },
    ) => Promise<{ success: boolean; newNonce?: string; error?: string }>
  >();
jest.mock("@server/services/webchat/dpop-proof.service", () => ({
  ...jest.requireActual<typeof import("@server/services/webchat/dpop-proof.service")>(
    "@server/services/webchat/dpop-proof.service",
  ),
  verifyDPoPForRequest: mockVerifyDPoP,
}));

const mockRateLimited =
  jest.fn<(checks: Array<{ rule: string; id: string }>) => Promise<boolean>>();
jest.mock("@server/services/webchat/webchat-settings.service", () => ({
  matchesAllowedDomains: () => false,
  webchatSettingsService: { getSettings: async () => ({ allowedDomains: [] }) },
}));
jest.mock("@server/services/public-widget-limits", () => ({
  PUBLIC_WIDGET_LIMITS: { maxMessageLength: 4000 },
  isPublicWidgetRateLimited: mockRateLimited,
}));

import * as jwt from "jsonwebtoken";
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
  closedWith?: number;
  close(code?: number): void {
    this.closedWith = code;
  }
  terminated = false;
  terminate(): void {
    this.terminated = true;
  }
  pinged = 0;
  ping(): void {
    this.pinged++;
  }
  last(): Record<string, unknown> | undefined {
    return this.sent[this.sent.length - 1];
  }
}

interface ServiceInternals {
  handleConnection(ws: unknown, req: unknown): void;
  handleMessage(clientId: string, data: string): Promise<void>;
  checkHeartbeats(): void;
  conversationClients: Map<string, Set<string>>;
}

function connect(
  service: WebSocketService,
  query = `org=${ORG_ID}`,
  headers: Record<string, string> = {},
) {
  const internals = service as unknown as ServiceInternals;
  const ws = new FakeSocket();
  internals.handleConnection(ws, {
    url: `/ws?${query}`,
    headers: { host: "localhost:3001", "x-forwarded-for": "203.0.113.7", ...headers },
    socket: { remoteAddress: "10.0.0.1" },
  });
  const clientId = ws.sent[0]?.clientId as string;
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

/** An identify frame carrying a (mocked) DPoP proof for the /ws endpoint. */
function identifyFrame(conversationId: string = CONV_ID) {
  return { type: "identify", conversationId, proof: "identify.jwt" };
}

const validFrame = {
  type: "message",
  content: "hello",
  proof: "proof.jwt",
  conversationId: CONV_ID,
};

describe("WebSocket public writes require DPoP", () => {
  let service: WebSocketService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebSocketService();
    mockVerifyDPoP.mockResolvedValue({ success: true, newNonce: "nonce-2" });
    mockRateLimited.mockResolvedValue(false);
  });

  it("identify without a conversationId does not create a conversation", async () => {
    const { ws, send } = connect(service);

    await send({ type: "identify" });

    expect(mockConversationRepo.create).not.toHaveBeenCalled();
    expect(ws.last()).toMatchObject({ type: "error" });
  });

  it("rejects a message on a conversation that has no registered public key", async () => {
    const conversation = webConversation({ publicJwk: null });
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { ws, send } = connect(service);

    await send(identifyFrame());
    await send({ type: "message", content: "hello" });

    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(ws.last()).toMatchObject({ type: "error" });
  });

  it("rejects a message without a DPoP proof", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { ws, send } = connect(service);

    await send(identifyFrame());
    await send({ type: "message", content: "hello" });

    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(mockVerifyDPoP).toHaveBeenCalledTimes(1); // the identify proof only
    expect(ws.last()).toMatchObject({ type: "error" });
  });

  it("rejects a message on a non-web conversation", async () => {
    const conversation = webConversation({ channel: "whatsapp" });
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { send } = connect(service);

    await send(identifyFrame());
    await send(validFrame);

    expect(conversation.addMessage).not.toHaveBeenCalled();
  });

  it("verifies the proof against the identified conversation, not a client-supplied id", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { ws, send } = connect(service);

    await send(identifyFrame());
    // A valid proof for the attacker's own conversation must not write into CONV_ID.
    await send({ ...validFrame, conversationId: OTHER_CONV_ID });

    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(ws.last()).toMatchObject({ type: "error" });
  });

  it("returns the fresh nonce when the proof's nonce expired", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    mockVerifyDPoP.mockResolvedValueOnce({ success: true }).mockResolvedValue({
      success: false,
      error: "Invalid or expired nonce",
      newNonce: "fresh",
    });
    const { ws, send } = connect(service);

    await send(identifyFrame());
    await send(validFrame);

    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(ws.last()).toEqual({ type: "error", error: "NONCE_EXPIRED", nonce: "fresh" });
  });

  it("accepts a message with a valid DPoP proof", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { ws, send } = connect(service);

    await send(identifyFrame());
    await send(validFrame);

    expect(mockVerifyDPoP).toHaveBeenCalledWith(
      CONV_ID,
      validFrame.proof,
      expect.objectContaining({ method: "POST", path: "/v1/publicConversations.sendMessage" }),
    );
    expect(conversation.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "hello" }),
    );
    expect(ws.last()).toEqual({ type: "message_sent", messageId: "msg-1", nonce: "nonce-2" });
  });

  it("rejects messages longer than the cap before verifying DPoP", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    const { ws, send } = connect(service);

    await send(identifyFrame());
    await send({ ...validFrame, content: "x".repeat(4001) });

    expect(mockVerifyDPoP).toHaveBeenCalledTimes(1); // the identify proof only
    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(ws.last()).toEqual({ type: "error", error: "Invalid message content" });
  });

  it("rate limits per proxied client IP before verifying the proof", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    mockRateLimited.mockResolvedValue(true);
    const { ws, send } = connect(service);

    await send(identifyFrame());
    await send(validFrame);

    expect(mockRateLimited).toHaveBeenCalledTimes(1);
    expect(mockRateLimited).toHaveBeenCalledWith([{ rule: "messagePerIp", id: "203.0.113.7" }]);
    expect(mockVerifyDPoP).toHaveBeenCalledTimes(1); // the identify proof only
    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(ws.last()).toEqual({ type: "error", error: "RATE_LIMITED" });
  });

  it("does not spend the per-conversation budget on a frame with a bad proof", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    mockVerifyDPoP
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValue({ success: false, error: "Public key mismatch" });
    const { send } = connect(service);

    await send(identifyFrame());
    await send(validFrame);

    expect(mockRateLimited).not.toHaveBeenCalledWith([
      { rule: "messagePerConversation", id: CONV_ID },
    ]);
  });

  it("rate limits per conversation once the proof is verified", async () => {
    const conversation = webConversation();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    mockRateLimited.mockImplementation(async (checks) =>
      checks.some((check) => check.rule === "messagePerConversation"),
    );
    const { ws, send } = connect(service);

    await send(identifyFrame());
    await send(validFrame);

    expect(mockVerifyDPoP).toHaveBeenCalled();
    expect(mockRateLimited).toHaveBeenLastCalledWith([
      { rule: "messagePerConversation", id: CONV_ID },
      { rule: "messagePerOrg", id: conversation.organization_id },
      { rule: "messagePerOrgHourly", id: conversation.organization_id },
    ]);
    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(ws.last()).toEqual({ type: "error", error: "RATE_LIMITED" });
  });

  it("does not let an unauthenticated client subscribe to an arbitrary conversation", async () => {
    const { send, clientId, internals } = connect(service);

    await send({ type: "subscribe", conversationId: OTHER_CONV_ID });

    expect(internals.conversationClients.get(OTHER_CONV_ID)?.has(clientId) ?? false).toBe(false);
  });
});

describe("WebSocket identify requires proof of the conversation key", () => {
  let service: WebSocketService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebSocketService();
    mockConversationRepo.findById.mockResolvedValue(webConversation());
  });

  it("rejects identify without a DPoP proof and streams nothing to that socket", async () => {
    const { ws, send, clientId, internals } = connect(service);

    await send({ type: "identify", conversationId: CONV_ID });

    expect(mockVerifyDPoP).not.toHaveBeenCalled();
    expect(internals.conversationClients.get(CONV_ID)?.has(clientId) ?? false).toBe(false);
    expect(ws.last()).toMatchObject({ type: "error" });
    expect(service.sendToConversation(CONV_ID, { type: "message" })).toBe(0);
  });

  it("rejects identify whose proof does not verify", async () => {
    mockVerifyDPoP.mockResolvedValue({ success: false, error: "Public key mismatch" });
    const { ws, send, clientId, internals } = connect(service);

    await send(identifyFrame());

    expect(internals.conversationClients.get(CONV_ID)?.has(clientId) ?? false).toBe(false);
    expect(ws.last()).toEqual({ type: "error", error: "Unauthorized" });
  });

  it("checks an identify proof against /ws whatever url the frame names", async () => {
    mockVerifyDPoP.mockResolvedValue({ success: true });
    const { send } = connect(service);

    await send({
      ...identifyFrame(),
      url: "http://localhost:3001/v1/publicConversations.getMessages",
    });

    expect(mockVerifyDPoP).toHaveBeenCalledWith(
      CONV_ID,
      "identify.jwt",
      expect.objectContaining({ method: "GET", path: "/ws", schemes: ["ws:", "wss:"] }),
      { checkNonce: false },
    );
  });

  it("attaches a client whose proof verifies, without consuming the HTTP nonce", async () => {
    mockVerifyDPoP.mockResolvedValue({ success: true });
    const { ws, send, clientId, internals } = connect(service);

    await send(identifyFrame());

    expect(mockVerifyDPoP).toHaveBeenCalledWith(
      CONV_ID,
      "identify.jwt",
      expect.objectContaining({ method: "GET", path: "/ws" }),
      { checkNonce: false },
    );
    expect(internals.conversationClients.get(CONV_ID)?.has(clientId)).toBe(true);
    expect(ws.last()).toEqual({ type: "identified", conversationId: CONV_ID });
  });

  it("moves a socket to a new conversation when it identifies again", async () => {
    mockVerifyDPoP.mockResolvedValue({ success: true });
    mockConversationRepo.findById.mockImplementation(async (id) => webConversation({ id }));
    const { send, clientId, internals } = connect(service);

    await send(identifyFrame());
    await send(identifyFrame(OTHER_CONV_ID));

    expect(internals.conversationClients.get(CONV_ID)?.has(clientId) ?? false).toBe(false);
    expect(internals.conversationClients.get(OTHER_CONV_ID)?.has(clientId)).toBe(true);
  });

  it("does not relay a client-chosen identity in typing events", async () => {
    mockVerifyDPoP.mockResolvedValue({ success: true });
    const first = connect(service);
    const second = connect(service);
    await first.send(identifyFrame());
    await second.send(identifyFrame());

    await first.send({ type: "typing", isTyping: true, customerId: "someone-else" });

    expect(second.ws.last()).toEqual({ type: "typing", isTyping: true });
  });
});

describe("WebSocket connection lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("closes a socket that neither authenticates nor identifies in time", () => {
    const service = new WebSocketService();
    const { ws } = connect(service);

    jest.advanceTimersByTime(10_000);

    expect(ws.closedWith).toBe(1008);
  });

  it("terminates a socket that missed a heartbeat", () => {
    const service = new WebSocketService();
    const { ws, internals } = connect(service);

    internals.checkHeartbeats();
    expect(ws.pinged).toBe(1);
    expect(ws.terminated).toBe(false);

    internals.checkHeartbeats();
    expect(ws.terminated).toBe(true);
  });

  it("keeps a socket that answers pings", () => {
    const service = new WebSocketService();
    const { ws, internals } = connect(service);

    internals.checkHeartbeats();
    ws.emit("pong");
    internals.checkHeartbeats();

    expect(ws.terminated).toBe(false);
  });

  it("caps open connections per client IP", () => {
    const service = new WebSocketService();
    for (let i = 0; i < 100; i++) connect(service);

    const { ws } = connect(service);

    expect(ws.closedWith).toBe(1008);
    expect(service.getConnectionCount()).toBe(100);
  });
});

describe("WebSocket dashboard authentication", () => {
  let service: WebSocketService;
  const activeUser = {
    id: "user-1",
    email: "a@b.c",
    isActive: true,
    emailVerified: true,
    tokenVersion: 2,
  };
  const sign = (payload: Record<string, unknown>) =>
    jwt.sign(
      { userId: "user-1", email: "a@b.c", type: "access", tokenVersion: 2, ...payload },
      "ws-test-secret",
    );

  const orgMembers = (service: WebSocketService) =>
    (service as unknown as { organizationClients: Map<string, Set<string>> }).organizationClients;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebSocketService();
    mockUserFindOne.mockResolvedValue(activeUser);
    mockUserOrgFindOne.mockResolvedValue({ id: "membership-1" });
  });

  it("streams org events to an active member of the requested org", async () => {
    const { ws, send, clientId } = connect(service);
    await send({ type: "auth", token: sign({}) });

    expect(orgMembers(service).get(ORG_ID)?.has(clientId)).toBe(true);
    expect(ws.last()).toEqual({ type: "authenticated" });
  });

  describe("re-validation of open sockets", () => {
    const revalidate = () =>
      (
        service as unknown as { revalidateDashboardClients(): Promise<void> }
      ).revalidateDashboardClients();
    const membership = { userId: "user-1", organizationId: ORG_ID };

    beforeEach(() => {
      mockUserFind.mockResolvedValue([activeUser]);
      mockUserOrgFind.mockResolvedValue([membership]);
      mockSessionFind.mockResolvedValue([{ id: "session-1" }]);
    });

    it("keeps a socket whose user, membership and session are still valid", async () => {
      const { ws, send, clientId } = connect(service);
      await send({ type: "auth", token: sign({ sid: "session-1" }) });

      await revalidate();

      expect(ws.closedWith).toBeUndefined();
      expect(orgMembers(service).get(ORG_ID)?.has(clientId)).toBe(true);
    });

    it.each([
      [
        "the password changed",
        () => mockUserFind.mockResolvedValue([{ ...activeUser, tokenVersion: 3 }]),
      ],
      [
        "the user was disabled",
        () => mockUserFind.mockResolvedValue([{ ...activeUser, isActive: false }]),
      ],
      ["the membership ended", () => mockUserOrgFind.mockResolvedValue([])],
      ["the session was revoked", () => mockSessionFind.mockResolvedValue([])],
    ])("closes the socket once %s", async (_label, change) => {
      const { ws, send, clientId } = connect(service);
      await send({ type: "auth", token: sign({ sid: "session-1" }) });

      change();
      await revalidate();

      expect(ws.closedWith).toBe(1008);
      expect(orgMembers(service).get(ORG_ID)?.has(clientId) ?? false).toBe(false);
    });

    it("leaves widget sockets alone", async () => {
      const { ws } = connect(service);

      await revalidate();

      expect(mockUserFind).not.toHaveBeenCalled();
      expect(ws.closedWith).toBeUndefined();
    });
  });

  it("ignores a token passed in the query string", async () => {
    const { send, clientId } = connect(service, `org=${ORG_ID}&token=${sign({})}`);
    await send({ type: "subscribe" });

    expect(mockUserFindOne).not.toHaveBeenCalled();
    expect(orgMembers(service).get(ORG_ID)?.has(clientId) ?? false).toBe(false);
  });

  it("does not stream org events to a user who is not a member of the requested org", async () => {
    mockUserOrgFindOne.mockResolvedValue(null);
    const { ws, send, clientId } = connect(service);
    await send({ type: "auth", token: sign({}) });

    expect(mockUserOrgFindOne).toHaveBeenCalledWith({
      where: { userId: "user-1", organizationId: ORG_ID, isActive: true },
    });
    expect(orgMembers(service).get(ORG_ID)?.has(clientId) ?? false).toBe(false);
    expect(ws.closedWith).toBe(1008);
  });

  it.each([
    ["a revoked token (tokenVersion bumped)", {}, { ...activeUser, tokenVersion: 3 }],
    ["a deactivated user", {}, { ...activeUser, isActive: false }],
    ["an unverified email", {}, { ...activeUser, emailVerified: false }],
    ["a plugin API token", { scope: "plugin-api", organizationId: ORG_ID }, activeUser],
    ["a refresh token", { type: "refresh" }, activeUser],
  ])("rejects %s", async (_label, claims, user) => {
    mockUserFindOne.mockResolvedValue(user);
    const { send, clientId } = connect(service);
    await send({ type: "auth", token: sign(claims) });

    expect(orgMembers(service).get(ORG_ID)?.has(clientId) ?? false).toBe(false);
  });

  it("rejects a token signed with another algorithm", async () => {
    const token = jwt.sign(
      { userId: "user-1", email: "a@b.c", type: "access", tokenVersion: 2 },
      "ws-test-secret",
      { algorithm: "HS512" },
    );
    const { send, clientId } = connect(service);
    await send({ type: "auth", token });

    expect(orgMembers(service).get(ORG_ID)?.has(clientId) ?? false).toBe(false);
  });

  it("rejects a browser connection from an origin outside the CORS list", async () => {
    const { send, clientId } = connect(service, `org=${ORG_ID}`, {
      origin: "https://evil.example.test",
    });
    await send({ type: "auth", token: sign({}) });

    expect(orgMembers(service).get(ORG_ID)?.has(clientId) ?? false).toBe(false);
  });

  it("accepts the dashboard origin", async () => {
    const { send, clientId } = connect(service, `org=${ORG_ID}`, {
      origin: "https://app.example.test",
    });
    await send({ type: "auth", token: sign({}) });

    expect(orgMembers(service).get(ORG_ID)?.has(clientId)).toBe(true);
  });
});

describe("WebSocket message events for webchat clients", () => {
  it("strip internal metadata before reaching a webchat client", async () => {
    jest.clearAllMocks();
    const service = new WebSocketService();
    mockConversationRepo.findById.mockResolvedValue(webConversation());
    mockVerifyDPoP.mockResolvedValue({ success: true });
    const { ws, send } = connect(service);
    await send(identifyFrame());

    (service as unknown as { handleRedisEvent(e: unknown): void }).handleRedisEvent({
      type: "message_received",
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      payload: {
        id: "m1",
        content: "Hi",
        type: "BotAgent",
        sender: "Hay.chat",
        timestamp: "2026-10-27T00:00:00Z",
        deliveryState: "sent",
        status: "sent",
        attachments: [],
        metadata: { originalMessage: "replaced answer", confidence: 0.3, isClosureMessage: true },
      },
    });
    // Attachments are signed before the send, so it happens on a later tick.
    await new Promise((resolve) => setImmediate(resolve));

    expect(ws.last()).toEqual({
      type: "message",
      conversationId: CONV_ID,
      data: {
        id: "m1",
        content: "Hi",
        type: "BotAgent",
        sender: "Hay.chat",
        timestamp: "2026-10-27T00:00:00Z",
        attachments: [],
        metadata: { isClosureMessage: true },
      },
    });
  });

  it("no longer serves load_history to unauthenticated clients", async () => {
    const service = new WebSocketService();
    const { ws, send } = connect(service);
    const before = ws.sent.length;
    await send({ type: "load_history", conversationId: CONV_ID });
    expect(ws.sent.length).toBe(before);
  });
});
