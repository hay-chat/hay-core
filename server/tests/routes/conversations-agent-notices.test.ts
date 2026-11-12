import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * conversations.takeover / release / sendMessage — the shopper is told when a
 * person joins or leaves, and sees the person's first name on their replies.
 * The stored System message carries the structured event the widget words in
 * the shopper's language; the surname never goes into the shopper-facing field.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

type FakeConversation = {
  id: string;
  organization_id: string;
  status: string;
  assigned_user_id: string | null;
  addMessage: jest.Mock<(data: Record<string, unknown>) => Promise<unknown>>;
  assignToUser: jest.Mock<(userId: string) => Promise<void>>;
  releaseFromUser: jest.Mock<(mode: string) => Promise<void>>;
};
let conversation: FakeConversation;

jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({ findByIdAndOrganization: async () => conversation })),
}));

const mockFindUser = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/user.repository", () => ({
  userRepository: { findById: (id: string) => mockFindUser(id) },
}));
jest.mock("@server/repositories/conversation-takeover-event.repository", () => ({
  conversationTakeoverEventRepository: {
    startTakeover: jest.fn(async () => undefined),
    endMostRecentOpenTakeover: jest.fn(async () => undefined),
  },
}));
jest.mock("@server/services/websocket.service", () => ({
  websocketService: { sendToOrganization: jest.fn() },
}));
const mockAnnounceAgentRead = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
jest.mock("@server/services/widget-events.service", () => ({
  announceAgentRead: (...args: unknown[]) => mockAnnounceAgentRead(...args),
}));

import { conversationsRouter } from "@server/routes/v1/conversations";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

const ctx = {
  user: {
    id: USER_ID,
    hasScope: () => true,
    getRole: () => "owner",
    userOrganization: { organization: {} },
  },
  organizationId: ORG_ID,
  req: { headers: {} },
  res: {},
} as unknown as Context;
const caller = () => conversationsRouter.createCaller(ctx);

const marina = {
  id: USER_ID,
  firstName: "Marina",
  lastName: "Souza",
  email: "marina@shop.example",
  avatarUrl: "https://cdn.example/avatars/marina.png",
  getFullName: () => "Marina Souza",
};

const storedMessage = () => conversation.addMessage.mock.calls[0][0];

describe("agent join/leave notices", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUser.mockResolvedValue(marina);
    conversation = {
      id: CONVERSATION_ID,
      organization_id: ORG_ID,
      status: "open",
      assigned_user_id: null,
      addMessage: jest.fn(async (data: Record<string, unknown>) => ({ id: "m1", ...data })),
      assignToUser: jest.fn(async () => undefined),
      releaseFromUser: jest.fn(async () => undefined),
    };
  });

  it("takeover stores an agent_joined System message with the first name", async () => {
    await caller().takeover({ conversationId: CONVERSATION_ID });

    expect(storedMessage()).toMatchObject({
      type: "System",
      metadata: {
        systemEvent: "agent_joined",
        agentFirstName: "Marina",
        agentAvatarUrl: "https://cdn.example/avatars/marina.png",
      },
    });
  });

  it("falls back to no name (widget says 'A team member') when the profile has none", async () => {
    mockFindUser.mockResolvedValue({ ...marina, firstName: "", getFullName: () => marina.email });

    await caller().takeover({ conversationId: CONVERSATION_ID });

    const metadata = storedMessage().metadata as Record<string, unknown>;
    expect(metadata.systemEvent).toBe("agent_joined");
    expect(metadata.agentFirstName).toBeUndefined();
  });

  it("release to AI stores agent_returned_to_ai", async () => {
    conversation.status = "human-took-over";
    conversation.assigned_user_id = USER_ID;

    await caller().release({ conversationId: CONVERSATION_ID, returnToMode: "ai" });

    expect(storedMessage()).toMatchObject({
      type: "System",
      metadata: { systemEvent: "agent_returned_to_ai", agentFirstName: "Marina" },
    });
  });

  it("release to the queue stores agent_left (no 'AI again' promise)", async () => {
    conversation.status = "human-took-over";
    conversation.assigned_user_id = USER_ID;

    await caller().release({ conversationId: CONVERSATION_ID, returnToMode: "queue" });

    expect(storedMessage()).toMatchObject({
      type: "System",
      metadata: { systemEvent: "agent_left", agentFirstName: "Marina" },
    });
  });

  it("a person's reply carries their first name", async () => {
    conversation.status = "human-took-over";
    conversation.assigned_user_id = USER_ID;

    await caller().sendMessage({
      conversationId: CONVERSATION_ID,
      content: "Hi, I can help",
      role: "assistant",
    });

    expect(storedMessage()).toMatchObject({
      type: "HumanAgent",
      metadata: {
        agentFirstName: "Marina",
        agentAvatarUrl: "https://cdn.example/avatars/marina.png",
      },
    });
  });

  it("refuses a reply in the assistant's name from someone who has not taken over", async () => {
    await expect(
      caller().sendMessage({
        conversationId: CONVERSATION_ID,
        content: "Hi",
        role: "assistant",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("a person without a photo is stored with agentAvatarUrl null (the widget shows the initial)", async () => {
    mockFindUser.mockResolvedValue({ ...marina, avatarUrl: undefined });

    await caller().takeover({ conversationId: CONVERSATION_ID });

    const metadata = storedMessage().metadata as Record<string, unknown>;
    expect(metadata.agentAvatarUrl).toBeNull();
  });
});

describe("conversations.get read receipts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conversation = {
      id: CONVERSATION_ID,
      organization_id: ORG_ID,
      status: "open",
      assigned_user_id: null,
      addMessage: jest.fn(async () => undefined),
      assignToUser: jest.fn(async () => undefined),
      releaseFromUser: jest.fn(async () => undefined),
    };
    (conversation as unknown as { messages: unknown[] }).messages = [
      { id: "m1", type: "Customer", created_at: new Date("2026-11-01T10:00:00Z") },
    ];
  });

  it("a person opening the conversation in the inbox announces it read", async () => {
    await conversationsRouter
      .createCaller({ ...ctx, user: { ...ctx.user, authMethod: "jwt" } } as unknown as Context)
      .get({ id: CONVERSATION_ID });

    expect(mockAnnounceAgentRead).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONVERSATION_ID }),
      expect.arrayContaining([expect.objectContaining({ id: "m1" })]),
    );
  });

  it("an API token reading the conversation is not a person reading it", async () => {
    await conversationsRouter
      .createCaller({ ...ctx, user: { ...ctx.user, authMethod: "apikey" } } as unknown as Context)
      .get({ id: CONVERSATION_ID });

    expect(mockAnnounceAgentRead).not.toHaveBeenCalled();
  });
});
