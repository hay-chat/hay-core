import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Dispute } from "../../database/entities/dispute.entity";
import { OrderConversationLink } from "../../database/entities/order-conversation-link.entity";
import { purgeAuditLogs } from "../helpers/audit-logs";

/**
 * D2-7 / D2-8: dispute intake (idempotent upsert, order match, one alert),
 * the 48h reminder, and the "Attach as draft" push to the plugin worker.
 * SQL runs for real; the PDF renderer, email, push and worker are the boundary.
 */

const sendTemplateEmail = jest.fn(async (_options: Record<string, unknown>) => ({ success: true }));
jest.mock("../../services/email.service", () => ({
  emailService: { sendTemplateEmail: (o: Record<string, unknown>) => sendTemplateEmail(o) },
  getOrganizationLocale: async () => "en",
}));
const onDisputeOpened = jest.fn(async (_args: Record<string, unknown>) => undefined);
jest.mock("../../services/push-notification.service", () => ({
  pushNotificationService: {
    onDisputeOpened: (a: Record<string, unknown>) => onDisputeOpened(a),
  },
}));
const render = jest.fn(async (_request: Record<string, unknown>) => ({
  pdf: Buffer.from("%PDF-fake"),
  locale: "en",
  overCap: false,
  imagesOmitted: false,
  attachments: [],
  conversationIds: [] as string[],
  storeName: "Acme",
  generatedAt: new Date("2026-10-28T10:00:00Z"),
}));
jest.mock("../../services/dispute-evidence/dispute-evidence.service", () => ({
  disputeEvidenceService: { render: (r: Record<string, unknown>) => render(r) },
}));

import { DisputesService, PUSH_PDF_MAX_BYTES } from "../../services/disputes/disputes.service";

describe("disputes (D2-7, D2-8)", () => {
  const orgId = "d2070000-0000-4000-8000-000000000001";
  const service = new DisputesService({
    platformName: (id) => (id === "stripe" ? "Stripe" : id === "shopify" ? "Shopify" : null),
    workerPort: async () => 49999,
  });
  const disputes = () => AppDataSource.getRepository(Dispute);
  let conversationId: string;
  const fetchMock = jest.fn<typeof fetch>();
  const realFetch = global.fetch;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(orgRepo.create({ id: orgId, name: "Disputes Org", slug: "disputes-org" }));
    }
    const conversation = await AppDataSource.getRepository(Conversation).save(
      AppDataSource.getRepository(Conversation).create({
        title: "Where is my order",
        organization_id: orgId,
        status: "resolved",
        metadata: {},
      }),
    );
    conversationId = conversation.id;
    await AppDataSource.getRepository(OrderConversationLink).save({
      organization_id: orgId,
      conversation_id: conversationId,
      message_id: null,
      plugin_id: "shopify",
      order_key: "5550001",
      order_label: "1001",
      source: "tool_output",
    });
    // Only named in message text: no plugin knows this order.
    await AppDataSource.getRepository(OrderConversationLink).save({
      organization_id: orgId,
      conversation_id: conversationId,
      message_id: null,
      plugin_id: null,
      order_key: "2002",
      order_label: "2002",
      source: "message_text",
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await disputes().delete({ organizationId: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  beforeEach(async () => {
    await disputes().delete({ organizationId: orgId });
    jest.clearAllMocks();
    render.mockImplementation(async () => ({
      pdf: Buffer.from("%PDF-fake"),
      locale: "en",
      overCap: false,
      imagesOmitted: false,
      attachments: [],
      conversationIds: [conversationId],
      storeName: "Acme",
      generatedAt: new Date("2026-10-28T10:00:00Z"),
    }));
  });

  const report = (overrides: Record<string, unknown> = {}) =>
    service.report(orgId, "stripe", {
      externalId: "dp_123",
      status: "needs_response",
      amount: "42.50",
      currency: "usd",
      reason: "product_not_received",
      evidenceDueBy: "2026-11-05T23:59:59Z",
      orderRefs: ["#1001"],
      ...overrides,
    });

  it("stores the dispute once, matches the order and alerts owners once", async () => {
    const first = await report();
    expect(first.created).toBe(true);
    expect(first.dispute.orderKey).toBe("5550001");
    expect(first.dispute.orderPluginId).toBe("shopify");
    expect(first.dispute.orderLabel).toBe("#1001");
    expect(first.dispute.currency).toBe("USD");
    const stored = await disputes().findOneByOrFail({ id: first.dispute.id });
    expect(stored.alertedAt).not.toBeNull();
    expect(first.dispute.alertedAt).toEqual(stored.alertedAt);
    expect(onDisputeOpened).toHaveBeenCalledTimes(1);
    expect(onDisputeOpened.mock.calls[0][0]).toMatchObject({
      organizationId: orgId,
      url: `/evidence?dispute=${first.dispute.id}&org=${orgId}`,
    });

    const again = await report({ status: "needs_response" });
    expect(again.created).toBe(false);
    expect(await disputes().count({ where: { organizationId: orgId } })).toBe(1);
    expect(onDisputeOpened).toHaveBeenCalledTimes(1);

    const closed = await report({ status: "won", orderRefs: undefined });
    expect(closed.dispute.status).toBe("won");
    expect(closed.dispute.orderRefs).toEqual(["#1001"]);
  });

  it("never matches an order that only message text mentions", async () => {
    const textOnly = await report({ externalId: "dp_text", orderRefs: ["#2002"] });
    expect(textOnly.dispute.orderKey).toBeNull();
    expect(textOnly.dispute.orderPluginId).toBeNull();

    // A later ref a plugin knows still matches.
    const mixed = await report({ externalId: "dp_mixed", orderRefs: ["#2002", "#1001"] });
    expect(mixed.dispute.orderKey).toBe("5550001");
    expect(mixed.dispute.orderPluginId).toBe("shopify");
  });

  it("does not alert for a dispute that arrives already decided", async () => {
    await report({ externalId: "dp_old", status: "lost" });
    expect(onDisputeOpened).not.toHaveBeenCalled();
  });

  it("reminds once inside the 48h window, never when evidence is drafted", async () => {
    const now = new Date("2026-11-04T12:00:00Z");
    await report({ externalId: "dp_soon", evidenceDueBy: "2026-11-05T12:00:00Z" });
    await report({ externalId: "dp_later", evidenceDueBy: "2026-11-20T12:00:00Z" });
    const drafted = await report({ externalId: "dp_done", evidenceDueBy: "2026-11-05T00:00:00Z" });
    await disputes().update({ id: drafted.dispute.id }, { evidenceStatus: "drafted" });
    jest.clearAllMocks();

    expect(await service.sendReminders(now)).toBe(1);
    expect(await service.sendReminders(now)).toBe(0);
    expect(sendTemplateEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("New chargeback") }),
    );
  });

  it("pushes the pack to the reporting plugin as a draft and records it", async () => {
    const { dispute } = await report();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, providerUrl: "https://dashboard.stripe.com/disputes/dp_123" }),
      ),
    );

    const result = await service.attachEvidence(orgId, dispute.id, null);
    expect(result).toEqual({
      ok: true,
      providerUrl: "https://dashboard.stripe.com/disputes/dp_123",
    });

    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationIds: [conversationId],
        template: "item_not_received",
        maxBytes: PUSH_PDF_MAX_BYTES,
      }),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:49999/disputes/evidence");
    const body = JSON.parse(String(init?.body));
    expect(body.disputeId).toBe("dp_123");
    expect(body.file.name).toMatch(/^hay-chat-evidence-1001-2026-10-28\.pdf$/);
    expect(Buffer.from(body.file.base64, "base64").toString()).toBe("%PDF-fake");
    expect(body.text.startsWith(body.marker)).toBe(true);
    expect(body).not.toHaveProperty("submit");

    const stored = await disputes().findOneByOrFail({ id: dispute.id });
    expect(stored.evidenceStatus).toBe("drafted");
    expect(stored.evidencePushedAt).not.toBeNull();
    const audit = await AppDataSource.query(
      `SELECT metadata FROM audit_logs WHERE organization_id = $1 AND action = 'dispute_evidence.push'`,
      [orgId],
    );
    expect(audit[0]?.metadata).toMatchObject({ ok: true, submitted: false });
    await purgeAuditLogs("organization_id = $1", [orgId]);
  });

  it("records the plugin's refusal and never pushes for a decided dispute", async () => {
    const { dispute } = await report();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, code: "SLOT_TAKEN", message: "taken" })),
    );
    const refused = await service.attachEvidence(orgId, dispute.id, null);
    expect(refused).toMatchObject({ ok: false, code: "SLOT_TAKEN" });
    expect((await disputes().findOneByOrFail({ id: dispute.id })).evidenceStatus).toBe("failed");

    await report({ status: "under_review" });
    fetchMock.mockClear();
    const late = await service.attachEvidence(orgId, dispute.id, null);
    expect(late).toMatchObject({ ok: false, code: "NOT_EDITABLE" });
    expect(fetchMock).not.toHaveBeenCalled();
    await purgeAuditLogs("organization_id = $1", [orgId]);
  });

  it("refuses a pack over the push cap and a dispute with no matching order", async () => {
    const { dispute } = await report();
    render.mockImplementationOnce(async () => ({
      pdf: Buffer.alloc(10),
      locale: "en",
      overCap: true,
      imagesOmitted: true,
      attachments: [],
      conversationIds: [conversationId],
      storeName: "Acme",
      generatedAt: new Date(),
    }));
    expect(await service.attachEvidence(orgId, dispute.id, null)).toMatchObject({
      ok: false,
      code: "TOO_LARGE",
    });

    const orphan = await report({ externalId: "dp_orphan", orderRefs: ["9999"] });
    expect(orphan.dispute.orderKey).toBeNull();
    expect(await service.attachEvidence(orgId, orphan.dispute.id, null)).toMatchObject({
      ok: false,
      code: "NO_ORDER",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
