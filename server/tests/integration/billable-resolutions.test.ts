import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { ConversationTakeoverEvent } from "../../database/entities/conversation-takeover-event.entity";
import { AnalyticsService } from "../../services/analytics.service";
import { ConversationRepository } from "../../repositories/conversation.repository";

/**
 * DB-backed: the billable count is SQL over jsonb and sub-queries, so a mock
 * would only restate the implementation.
 */
describe("billable resolutions", () => {
  const orgId = "b111ab1e-0000-4000-8000-000000000001";
  const userId = "b111ab1e-0000-4000-8000-0000000000aa";
  const periodStart = new Date("2026-10-01T00:00:00Z");
  const periodEnd = new Date("2026-10-31T23:59:59Z");
  const inPeriod = new Date("2026-10-15T12:00:00Z");

  const analytics = new AnalyticsService();
  const repository = new ConversationRepository();

  const metrics = () =>
    analytics.getConversationMetrics({
      organizationId: orgId,
      startDate: periodStart,
      endDate: periodEnd,
    });

  async function seed(overrides: Partial<Conversation> = {}): Promise<Conversation> {
    const repo = AppDataSource.getRepository(Conversation);
    const saved = await repo.save(
      repo.create({
        title: "billing test",
        organization_id: orgId,
        status: "resolved",
        ended_at: inPeriod,
        resolution_metadata: {
          resolved: true,
          confidence: 1,
          reason: "user_indicated_close_satisfied",
        },
        metadata: {},
        ...overrides,
      }),
    );
    // created_at is a CreateDateColumn; pin it inside the period unless the
    // test overrides it.
    await repo.update({ id: saved.id }, { created_at: overrides.created_at ?? inPeriod });
    return saved;
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.runMigrations();

    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(
        orgRepo.create({ id: orgId, name: "Billing Test Org", slug: "billing-test-org" }),
      );
    }

    const userRepo = AppDataSource.getRepository(User);
    if (!(await userRepo.findOne({ where: { id: userId } }))) {
      await userRepo.save(
        userRepo.create({ id: userId, email: "billing-test@example.com", password: "x" }),
      );
    }
  });

  beforeEach(async () => {
    await AppDataSource.getRepository(ConversationTakeoverEvent).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
  });

  afterAll(async () => {
    await AppDataSource.getRepository(ConversationTakeoverEvent).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    await AppDataSource.getRepository(User).delete({ id: userId });
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("bills a plain AI resolution and keeps resolvedConversations unchanged", async () => {
    await seed();
    const result = await metrics();
    expect(result.resolvedConversations).toBe(1);
    expect(result.billableResolutions).toBe(1);
  });

  it("does not bill playground, test-mode, demo playground or runKind conversations", async () => {
    await seed({ metadata: { sourceId: "playground", test_mode: true } });
    await seed({ metadata: { test_mode: true } });
    await seed({ metadata: { isPlayground: true } });
    await seed({ metadata: { runKind: "simulation" } });
    const result = await metrics();
    expect(result.resolvedConversations).toBe(4);
    expect(result.billableResolutions).toBe(0);
  });

  it("does not bill an unhappy close but keeps 'thanks' and inactivity closes billable", async () => {
    await seed({
      resolution_metadata: {
        resolved: false,
        confidence: 1,
        reason: "user_indicated_close_unsatisfied",
      },
    });
    await seed({
      resolution_metadata: { resolved: false, confidence: 1, reason: "user_indicated_greet" },
    });
    await seed({
      resolution_metadata: { resolved: false, confidence: 1, reason: "inactivity_timeout" },
    });
    await seed({ resolution_metadata: null });
    expect((await metrics()).billableResolutions).toBe(3);
  });

  it("does not bill conversations that were handed off, even if handed back to the AI", async () => {
    await seed({ summary: "Customer wants a refund; AI handed off" });

    const takenOver = await seed();
    await AppDataSource.getRepository(ConversationTakeoverEvent).save({
      organization_id: orgId,
      conversation_id: takenOver.id,
      user_id: userId,
      started_at: inPeriod,
      ended_at: inPeriod,
    });

    const humanReplied = await seed();
    await AppDataSource.getRepository(Message).save({
      conversation_id: humanReplied.id,
      content: "Hi, a human here",
      type: MessageType.HUMAN_AGENT,
    });

    await seed();
    expect((await metrics()).billableResolutions).toBe(1);
  });

  it("counts by resolution time, not creation time", async () => {
    // Opened last period, resolved in this one: bills now.
    await seed({ created_at: new Date("2026-09-30T23:00:00Z"), ended_at: inPeriod });
    // Opened this period, resolved next period: bills next period.
    await seed({ created_at: inPeriod, ended_at: new Date("2026-11-01T01:00:00Z") });
    // Staff resolution stamps closed_at only.
    await seed({ ended_at: null, closed_at: inPeriod });

    const result = await metrics();
    expect(result.billableResolutions).toBe(2);
    // The legacy count still uses created_at.
    expect(result.resolvedConversations).toBe(2);
  });

  it("ignores unresolved, closed and deleted conversations", async () => {
    await seed({ status: "open", ended_at: null });
    await seed({ status: "closed", closed_at: inPeriod });
    await seed({ deleted_at: inPeriod });
    expect(await repository.countBillableResolutions({ organizationId: orgId })).toBe(0);
  });
});
