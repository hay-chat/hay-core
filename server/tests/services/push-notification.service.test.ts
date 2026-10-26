import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * pushNotificationService — fan-out to opted-in devices of active members when
 * a conversation needs a human, pruning of dead subscriptions, and the
 * "not configured" no-op.
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

const mockGetMany = jest.fn<() => Promise<unknown[]>>();
type QueryBuilderMock = {
  innerJoin: jest.Mock<(table: string, alias: string, condition: string) => QueryBuilderMock>;
  where: jest.Mock<(condition: string, params: Record<string, unknown>) => QueryBuilderMock>;
  getMany: typeof mockGetMany;
};
const queryBuilder: QueryBuilderMock = {
  innerJoin: jest.fn(() => queryBuilder),
  where: jest.fn(() => queryBuilder),
  getMany: mockGetMany,
};
const mockRepo = {
  find: jest.fn<(options: unknown) => Promise<unknown[]>>(),
  upsert: jest.fn<(row: unknown, conflict: string[]) => Promise<unknown>>(async () => ({})),
  delete: jest.fn<(criteria: unknown) => Promise<{ affected: number }>>(),
  createQueryBuilder: jest.fn(() => queryBuilder),
};
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => mockRepo },
}));

const mockGetOrganizationLocale = jest.fn<() => Promise<string>>(async () => "en");
jest.mock("@server/services/email.service", () => ({
  getOrganizationLocale: mockGetOrganizationLocale,
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

const testPayload = { kind: "test" as const, title: "t", body: "b", url: "/", tag: "test" };

function configure() {
  pushConfig.vapidPublicKey = "public-key";
  pushConfig.vapidPrivateKey = "private-key";
  pushConfig.vapidSubject = "mailto:alerts@example.com";
}

beforeEach(() => {
  jest.clearAllMocks();
  pushConfig.vapidPublicKey = "";
  pushConfig.vapidPrivateKey = "";
  pushConfig.vapidSubject = "";
  mockRepo.delete.mockResolvedValue({ affected: 1 });
  mockGetOrganizationLocale.mockResolvedValue("en");
});

describe("configuration", () => {
  it("reports no public key and sends nothing when VAPID keys are missing", async () => {
    mockGetMany.mockResolvedValue([subscription("a")]);

    expect(pushNotificationService.isConfigured()).toBe(false);
    expect(pushNotificationService.getPublicKey()).toBeNull();

    const result = await pushNotificationService.sendToOrganization(ORG_ID, testPayload);

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
    expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("notifies every active member's device with a deep link to the conversation", async () => {
    configure();
    mockGetMany.mockResolvedValue([subscription("a"), subscription("b")]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await pushNotificationService.onConversationStatusChanged(pendingHumanConversation as never);

    // Only devices of users who are still active members of the organization
    expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
      "user_organizations",
      "uo",
      expect.stringContaining("uo.is_active = true"),
    );
    expect(queryBuilder.where).toHaveBeenCalledWith("s.organization_id = :organizationId", {
      organizationId: ORG_ID,
    });
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      "mailto:alerts@example.com",
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
    mockGetMany.mockResolvedValue([subscription("a")]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await pushNotificationService.onConversationStatusChanged({
      ...pendingHumanConversation,
      customer: null,
      summary: null,
    } as never);

    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.body).toBe("Order 1042 refund. Tap to open the conversation and take over.");
  });

  it("uses the organization's locale for the copy", async () => {
    configure();
    mockGetOrganizationLocale.mockResolvedValue("pt-BR");
    mockGetMany.mockResolvedValue([subscription("a")]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await pushNotificationService.onConversationStatusChanged(pendingHumanConversation as never);

    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.title).toBe("Um cliente precisa de um humano");
  });
});

describe("dead subscriptions", () => {
  it("deletes subscriptions the push service reports as gone (404/410) and keeps the rest", async () => {
    configure();
    mockGetMany.mockResolvedValue([
      subscription("alive"),
      subscription("gone"),
      subscription("expired"),
      subscription("flaky"),
    ]);
    mockSendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("Not found"), { statusCode: 404 }))
      .mockRejectedValueOnce(Object.assign(new Error("Server error"), { statusCode: 500 }));

    const result = await pushNotificationService.sendToOrganization(ORG_ID, testPayload);

    expect(result).toEqual({ sent: 1, removed: 2 });
    expect(mockRepo.delete).toHaveBeenCalledTimes(2);
    expect(mockRepo.delete).toHaveBeenCalledWith({ id: "gone" });
    expect(mockRepo.delete).toHaveBeenCalledWith({ id: "expired" });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("sendTest", () => {
  it("only targets the caller's own devices", async () => {
    configure();
    mockRepo.find.mockResolvedValue([subscription("mine")]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    const result = await pushNotificationService.sendTest(USER_ID, ORG_ID);

    expect(mockRepo.find).toHaveBeenCalledWith({ where: { user_id: USER_ID } });
    expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 1, removed: 0 });
    expect(JSON.parse(mockSendNotification.mock.calls[0][1])).toMatchObject({
      kind: "test",
      title: "Hay alerts are on",
      url: "/",
    });
  });
});

describe("subscribe / unsubscribe / removeForMember", () => {
  it("upserts on the endpoint so a device re-subscribing under another user or org moves instead of duplicating", async () => {
    await pushNotificationService.subscribe(USER_ID, ORG_ID, {
      endpoint: "https://push.example.com/a",
      keys: { p256dh: "new-p256dh", auth: "new-auth" },
      userAgent: "x".repeat(300),
    });

    expect(mockRepo.upsert).toHaveBeenCalledTimes(1);
    const [row, conflictPaths] = mockRepo.upsert.mock.calls[0];
    expect(conflictPaths).toEqual(["endpoint"]);
    expect(row).toMatchObject({
      endpoint: "https://push.example.com/a",
      user_id: USER_ID,
      organization_id: ORG_ID,
      p256dh: "new-p256dh",
      auth: "new-auth",
    });
    expect(((row as { user_agent: string }).user_agent ?? "").length).toBe(255);
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

  it("drops every device of a member removed from the organization", async () => {
    await pushNotificationService.removeForMember(USER_ID, ORG_ID);
    expect(mockRepo.delete).toHaveBeenCalledWith({ user_id: USER_ID, organization_id: ORG_ID });
  });
});
