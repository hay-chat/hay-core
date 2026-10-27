import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * pushNotificationService — device registry (subscribe, rotate, logout drop),
 * delivery to one user's devices, pruning of dead subscriptions, and the
 * "not configured" no-op. Who gets alerted is conversation-alert.service.
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
  upsert: jest.fn<(row: unknown, conflict: string[]) => Promise<unknown>>(async () => ({})),
  findOne: jest.fn<(options: unknown) => Promise<unknown>>(),
  update: jest.fn<(criteria: unknown, data: unknown) => Promise<unknown>>(async () => ({})),
  delete: jest.fn<(criteria: unknown) => Promise<{ affected: number }>>(),
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

const subscription = (id: string) => ({
  id,
  user_id: USER_ID,
  endpoint: `https://push.example.com/${id}`,
  p256dh: "p256dh",
  auth: "auth",
});

const payload = {
  kind: "conversation_needs_attention" as const,
  title: "A customer needs a human",
  body: "Ana: refund",
  url: "/conversations/c1?org=o1",
  tag: "conversation:c1",
};

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
    mockRepo.find.mockResolvedValue([subscription("a")]);

    expect(pushNotificationService.isConfigured()).toBe(false);
    expect(pushNotificationService.getPublicKey()).toBeNull();

    const result = await pushNotificationService.sendToUser(USER_ID, payload);

    expect(result).toEqual({ devices: 1, sent: 0, removed: 0 });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("exposes the public key once configured", () => {
    configure();
    expect(pushNotificationService.getPublicKey()).toBe("public-key");
  });
});

describe("sendToUser", () => {
  it("sends the payload to every device of the user with a one-hour TTL", async () => {
    configure();
    mockRepo.find.mockResolvedValue([subscription("a"), subscription("b")]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    const result = await pushNotificationService.sendToUser(USER_ID, payload);

    expect(mockRepo.find).toHaveBeenCalledWith({ where: { user_id: USER_ID } });
    expect(result).toEqual({ devices: 2, sent: 2, removed: 0 });
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      "mailto:alerts@example.com",
      "public-key",
      "private-key",
    );
    const [target, body, options] = mockSendNotification.mock.calls[0];
    expect(target).toEqual({
      endpoint: "https://push.example.com/a",
      keys: { p256dh: "p256dh", auth: "auth" },
    });
    expect(options.TTL).toBe(3600);
    expect(JSON.parse(body)).toEqual(payload);
  });

  it("deletes subscriptions the push service reports as gone (404/410) and keeps the rest", async () => {
    configure();
    mockRepo.find.mockResolvedValue([
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

    const result = await pushNotificationService.sendToUser(USER_ID, payload);

    expect(result).toEqual({ devices: 4, sent: 1, removed: 2 });
    expect(mockRepo.delete).toHaveBeenCalledTimes(2);
    expect(mockRepo.delete).toHaveBeenCalledWith({ id: "gone" });
    expect(mockRepo.delete).toHaveBeenCalledWith({ id: "expired" });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("sendTest", () => {
  it("only targets the caller's own devices, in the organization's language", async () => {
    configure();
    mockGetOrganizationLocale.mockResolvedValue("pt-BR");
    mockRepo.find.mockResolvedValue([subscription("mine")]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    const result = await pushNotificationService.sendTest(USER_ID, ORG_ID);

    expect(mockRepo.find).toHaveBeenCalledWith({ where: { user_id: USER_ID } });
    expect(result).toEqual({ sent: 1, removed: 0 });
    expect(JSON.parse(mockSendNotification.mock.calls[0][1])).toMatchObject({
      kind: "test",
      title: "Alertas do Hay.chat ativados",
      url: "/",
    });
  });
});

describe("subscribe / unsubscribe / rotate", () => {
  it("upserts on the endpoint (per user, no organization) so re-syncing is idempotent", async () => {
    await pushNotificationService.subscribe(USER_ID, {
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
      p256dh: "new-p256dh",
      auth: "new-auth",
    });
    expect(row).not.toHaveProperty("organization_id");
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

  it("re-points a rotated subscription found by its old endpoint", async () => {
    mockRepo.findOne.mockResolvedValue(subscription("old"));
    const rotated = await pushNotificationService.rotate("https://push.example.com/old", {
      endpoint: "https://push.example.com/new",
      keys: { p256dh: "p2", auth: "a2" },
    });
    expect(rotated).toBe(true);
    expect(mockRepo.delete).toHaveBeenCalledWith({ endpoint: "https://push.example.com/new" });
    expect(mockRepo.update).toHaveBeenCalledWith(
      { id: "old" },
      { endpoint: "https://push.example.com/new", p256dh: "p2", auth: "a2" },
    );
  });

  it("ignores a rotation for an unknown endpoint", async () => {
    mockRepo.findOne.mockResolvedValue(null);
    const rotated = await pushNotificationService.rotate("https://push.example.com/unknown", {
      endpoint: "https://push.example.com/new",
      keys: { p256dh: "p2", auth: "a2" },
    });
    expect(rotated).toBe(false);
    expect(mockRepo.update).not.toHaveBeenCalled();
  });
});
