import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D13-11: the generic "channel failing" signal — threshold, alert fan-out,
 * alert throttling and clearing.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/config/env", () => ({ getDashboardUrl: () => "https://app.hay.test" }));

const query = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>();
jest.mock("@server/database/data-source", () => ({ AppDataSource: { query } }));

type Instance = {
  id: string;
  channelHealth: Record<string, unknown> | null;
  plugin: { name: string };
};
let instance: Instance | null;
const updateChannelHealth = jest.fn(async (_id: string, health: Record<string, unknown>) => {
  if (instance) instance.channelHealth = health;
});
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {
    findByOrgAndPlugin: jest.fn(async () => instance),
    updateChannelHealth,
  },
}));
jest.mock("@server/services/notification-locale", () => ({
  organizationNotificationLocale: jest.fn(async () => "pt-BR"),
}));
const sendTemplateEmail = jest.fn(async (_options: Record<string, unknown>) => ({ success: true }));
jest.mock("@server/services/email.service", () => ({ emailService: { sendTemplateEmail } }));
const onChannelFailing = jest.fn(async (_args: Record<string, unknown>) => undefined);
jest.mock("@server/services/push-notification.service", () => ({
  pushNotificationService: { onChannelFailing },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { findPluginIdByChannel: jest.fn(async () => "hay-channel-whatsapp") },
}));

import { channelHealthService } from "@server/services/channel-health.service";

const admins = [
  { id: "u1", email: "owner@acme.com", first_name: "Ana" },
  { id: "u2", email: "admin@acme.com", first_name: null },
];

function mockQueries(failures: number) {
  query.mockImplementation(async (sql: string) =>
    sql.includes("COUNT(*)") ? [{ count: String(failures) }] : admins,
  );
}

describe("channelHealthService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    instance = { id: "pi-1", channelHealth: null, plugin: { name: "WhatsApp" } };
  });

  it("stays quiet below the failure threshold", async () => {
    mockQueries(2);
    await channelHealthService.recordDeliveryFailure("org-1", "whatsapp");
    expect(updateChannelHealth).not.toHaveBeenCalled();
    expect(sendTemplateEmail).not.toHaveBeenCalled();
  });

  it("never counts recipient bounces or complaints as channel failures", async () => {
    mockQueries(2);
    await channelHealthService.recordDeliveryFailure("org-1", "email");
    const [, params] = query.mock.calls.find(([sql]) => sql.includes("COUNT(*)"))!;
    expect(params?.[3]).toEqual(expect.arrayContaining(["bounced", "complained"]));
  });

  it("marks the channel failing and alerts every owner and admin by email and push", async () => {
    mockQueries(3);
    await channelHealthService.recordDeliveryFailure("org-1", "whatsapp");

    expect(instance?.channelHealth).toMatchObject({
      status: "failing",
      reason: "delivery_failures",
    });
    expect(sendTemplateEmail).toHaveBeenCalledTimes(2);
    expect(sendTemplateEmail.mock.calls[0][0]).toMatchObject({
      to: "owner@acme.com",
      template: "notification",
      locale: "pt-BR",
      subject: "WhatsApp está com falhas no Hay.chat",
      variables: expect.objectContaining({
        companyName: "Hay.chat",
        actionButton: expect.objectContaining({
          url: "https://app.hay.test/integrations/plugins/hay-channel-whatsapp?org=org-1",
        }),
      }),
    });
    expect(onChannelFailing).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        tag: "channel-failing:hay-channel-whatsapp",
      }),
    );
    // The admin query is limited to active owners and admins.
    const adminSql = query.mock.calls.find(([sql]) => sql.includes("uo.role"))?.[0];
    expect(adminSql).toMatch(/uo\.role IN \('owner', 'admin'\)/);
  });

  it("does not alert again within the cooldown, even after recovering", async () => {
    mockQueries(5);
    await channelHealthService.recordDeliveryFailure("org-1", "whatsapp");
    await channelHealthService.recordDeliverySuccess("org-1", "hay-channel-whatsapp");
    expect(instance?.channelHealth).toMatchObject({ status: "ok" });

    await channelHealthService.recordDeliveryFailure("org-1", "whatsapp");
    expect(instance?.channelHealth).toMatchObject({ status: "failing" });
    expect(sendTemplateEmail).toHaveBeenCalledTimes(2); // one alert, two admins
  });

  it("a successful delivery does not clear a plugin-reported quality drop", async () => {
    mockQueries(0);
    await channelHealthService.markFailing("org-1", "hay-channel-whatsapp", "quality_drop", "RED");
    await channelHealthService.recordDeliverySuccess("org-1", "hay-channel-whatsapp");
    expect(instance?.channelHealth).toMatchObject({ status: "failing", reason: "quality_drop" });

    await channelHealthService.markOk("org-1", "hay-channel-whatsapp", ["quality_drop"]);
    expect(instance?.channelHealth).toMatchObject({ status: "ok" });
  });
});
