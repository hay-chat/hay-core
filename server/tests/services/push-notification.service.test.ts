import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * pushNotificationService — fan-out to opted-in devices when a conversation
 * needs a human, pruning of dead subscriptions, and the "not configured" no-op.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const pushConfig = { vapidPublicKey: "", vapidPrivateKey: "", vapidSubject: "" };
jest.mock("@server/config/env", () => ({ config: { push: pushConfig } }));

const mockSendNotification =
  jest.fn<(target: unknown, body: string, options: { TTL: number }) => Promise<unknown>>();
const mockSetVapidDetails = jest.fn();
jest.mock("web-push", () => ({
  __esModule: true,
  default: { sendNotification: mockSendNotification, setVapidDetails: mockSetVapidDetails },
}));

const mockRepo = {
  find: jest.fn<(options: unknown) => Promise<unknown[]>>(),
  findOne: jest.fn<(options: unknown) => Promise<unknown>>(),
  create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
  save: jest.fn(async (row: unknown) => row),
  delete: jest.fn<(criteria: unknown) => Promise<{ affected: number }>>(),
};
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => mockRepo },
}));

jest.mock("@server/services/email.service", () => ({
  getOrganizationLocale: jest.fn(async () => "en"),
}));

import { pushNotificationService } from "@server/services/push-notification.service";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

const subscription = (id: string) => ({
  id,
  user_id: USER_ID,
  organization_id: ORG_ID,
  endpoint: `https://push.example.com/${id}`,
  p256dh: "p256dh",
  auth: "auth",
});

const pendingHumanConversation = {
  id: CONVERSATION_ID,
  organization_id: ORG_ID,
  status: "pending-human",
  title: "Order 1042 refund",
  summary: "Customer wants a refund for a damaged item.",
  customer: { name: "Ana" },
};

function configure() {
  pushConfig.vapidPublicKey = "public-key";
  pushConfig.vapidPrivateKey = "private-key";
  pushConfig.vapidSubject = "mailto:support@hay.chat";
}

beforeEach(() => {
  jest.clearAllMocks();
  pushConfig.vapidPublicKey = "";
  pushConfig.vapidPrivateKey = "";
  pushConfig.vapidSubject = "";
  mockRepo.delete.mockResolvedValue({ affected: 1 });
});

describe("configuration", () => {
  it("reports no public key and sends nothing when VAPID keys are missing", async () => {
    mockRepo.find.mockResolvedValue([subscription("a")]);

    expect(pushNotificationService.isConfigured()).toBe(false);
    expect(pushNotificationService.getPublicKey()).toBeNull();

    const result = await pushNotificationService.sendToOrganization(ORG_ID, {
      kind: "test",
      title: "t",
      body: "b",
      url: "/",
      tag: "test",
    });

    expect(result).toEqual({ sent: 0, removed: 0 });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("exposes the public key once configured", () => {
    configure();
    expect(pushNotificationService.getPublicKey()).toBe("public-key");
  });
});

describe("onConversationStatusChanged", () => {
  it("ignores statuses other than pending-human", async () => {
    configure();
    await pushNotificationService.onConversationStatusChanged({
      ...pendingHumanConversation,
      status: "human-took-over",
    } as never);
    expect(mockRepo.find).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("notifies every device in the organization with a deep link to the conversation", async () => {
    configure();
    mockRepo.find.mockResolvedValue([subscription("a"), subscription("b")]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await pushNotificationService.onConversationStatusChanged(pendingHumanConversation as never);

    expect(mockRepo.find).toHaveBeenCalledWith({ where: { organization_id: ORG_ID } });
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      "mailto:support@hay.chat",
      "public-key",
      "private-key",
    );
    expect(mockSendNotification).toHaveBeenCalledTimes(2);

    const [target, body, options] = mockSendNotification.mock.calls[0];
    expect(target).toEqual({
      endpoint: "https://push.example.com/a",
      keys: { p256dh: "p256dh", auth: "auth" },
    });
    expect(options.TTL).toBe(3600);

    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      kind: "conversation_needs_attention",
      title: "A customer needs a human",
      url: `/conversations/${CONVERSATION_ID}`,
      tag: `conversation:${CONVERSATION_ID}`,
    });
    expect(payload.body).toBe("Ana: Customer wants a refund for a damaged item.");
  });

  it("falls back to the title and a generic hint when there is no customer name or summary", async () => {
    configure();
    mockRepo.find.mockResolvedValue([subscription("a")]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await pushNotificationService.onConversationStatusChanged({
      ...pendingHumanConversation,
      customer: null,
      summary: null,
    } as never);

    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.body).toBe("Order 1042 refund. Tap to open the conversation and take over.");
  });
});

describe("dead subscriptions", () => {
  it("deletes subscriptions the push service reports as gone and keeps the rest", async () => {
    configure();
    mockRepo.find.mockResolvedValue([
      subscription("alive"),
      subscription("gone"),
      subscription("flaky"),
    ]);
    mockSendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("Server error"), { statusCode: 500 }));

    const result = await pushNotificationService.sendToOrganization(ORG_ID, {
      kind: "test",
      title: "t",
      body: "b",
      url: "/",
      tag: "test",
    });

    expect(result).toEqual({ sent: 1, removed: 1 });
    expect(mockRepo.delete).toHaveBeenCalledTimes(1);
    expect(mockRepo.delete).toHaveBeenCalledWith({ id: "gone" });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("subscribe / unsubscribe", () => {
  it("re-points an existing endpoint to the current user and organization instead of duplicating it", async () => {
    const existing = {
      ...subscription("a"),
      user_id: "someone-else",
      organization_id: "other-org",
    };
    mockRepo.findOne.mockResolvedValue(existing);

    const row = await pushNotificationService.subscribe(USER_ID, ORG_ID, {
      endpoint: existing.endpoint,
      keys: { p256dh: "new-p256dh", auth: "new-auth" },
      userAgent: "x".repeat(300),
    });

    expect(mockRepo.create).not.toHaveBeenCalled();
    expect(row).toMatchObject({
      user_id: USER_ID,
      organization_id: ORG_ID,
      p256dh: "new-p256dh",
      auth: "new-auth",
    });
    expect((row.user_agent as string).length).toBe(255);
  });

  it("creates a new row for an unknown endpoint", async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await pushNotificationService.subscribe(USER_ID, ORG_ID, {
      endpoint: "https://push.example.com/new",
      keys: { p256dh: "k", auth: "a" },
    });
    expect(mockRepo.create).toHaveBeenCalledWith({ endpoint: "https://push.example.com/new" });
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });

  it("only removes the caller's own subscription", async () => {
    mockRepo.delete.mockResolvedValue({ affected: 0 });
    const removed = await pushNotificationService.unsubscribe(
      USER_ID,
      "https://push.example.com/a",
    );
    expect(mockRepo.delete).toHaveBeenCalledWith({
      endpoint: "https://push.example.com/a",
      user_id: USER_ID,
    });
    expect(removed).toBe(false);
  });
});
