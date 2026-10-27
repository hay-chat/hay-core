import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Agent } from "../../database/entities/agent.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { DeliveryState } from "../../types/message-feedback.types";
import { AnalyticsService } from "../../services/analytics.service";

/**
 * DB-backed: both metrics are raw SQL (window-free subqueries, percentiles,
 * FILTER), so a mock would only restate the implementation.
 */
describe("analytics: response time and per-agent performance", () => {
  const orgId = "a7a10710-0000-4000-8000-000000000001";
  const agentA = "a7a10710-0000-4000-8000-0000000000a1";
  const agentB = "a7a10710-0000-4000-8000-0000000000b2";
  const t0 = new Date("2026-10-15T12:00:00Z");
  const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

  const analytics = new AnalyticsService();

  async function seedConversation(overrides: Partial<Conversation> = {}): Promise<Conversation> {
    const repo = AppDataSource.getRepository(Conversation);
    const saved = await repo.save(
      repo.create({
        title: "analytics test",
        organization_id: orgId,
        status: "open",
        metadata: {},
        ...overrides,
      }),
    );
    await repo.update({ id: saved.id }, { created_at: overrides.created_at ?? t0 });
    return saved;
  }

  async function seedMessage(
    conversationId: string,
    type: MessageType,
    createdAt: Date,
    extra: Partial<Message> = {},
  ): Promise<void> {
    const repo = AppDataSource.getRepository(Message);
    const saved = await repo.save(
      repo.create({ conversation_id: conversationId, content: type, type, ...extra }),
    );
    await repo.update({ id: saved.id }, { created_at: createdAt });
  }

  async function cleanup() {
    const conversations = await AppDataSource.getRepository(Conversation).find({
      where: { organization_id: orgId },
      select: ["id"],
    });
    for (const { id } of conversations) {
      await AppDataSource.getRepository(Message).delete({ conversation_id: id });
    }
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.runMigrations();

    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(
        orgRepo.create({ id: orgId, name: "Analytics Test Org", slug: "analytics-test-org" }),
      );
    }
    const agentRepo = AppDataSource.getRepository(Agent);
    for (const id of [agentA, agentB]) {
      if (!(await agentRepo.findOne({ where: { id } }))) {
        await agentRepo.save(agentRepo.create({ id, name: id, organization_id: orgId }));
      }
    }
  });

  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await AppDataSource.getRepository(Agent).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  describe("getResponseTimeAnalytics", () => {
    it("returns zeros and sampleSize 0 when nothing was answered", async () => {
      const conversation = await seedConversation();
      await seedMessage(conversation.id, MessageType.CUSTOMER, at(0));

      expect(await analytics.getResponseTimeAnalytics({ organizationId: orgId })).toEqual({
        averageResponseTime: 0,
        medianResponseTime: 0,
        p95ResponseTime: 0,
        sampleSize: 0,
      });
    });

    it("measures each customer turn from its first message to the first sent reply", async () => {
      const conversation = await seedConversation();
      // Turn 1: two customer messages, answered by the bot 10 s after the first.
      await seedMessage(conversation.id, MessageType.CUSTOMER, at(0));
      await seedMessage(conversation.id, MessageType.CUSTOMER, at(5));
      await seedMessage(conversation.id, MessageType.BOT_AGENT, at(10));
      // A second bot message in the same turn does not create a new sample.
      await seedMessage(conversation.id, MessageType.BOT_AGENT, at(12));
      // Turn 2: answered by a human after 30 s; system/tool rows are not replies.
      await seedMessage(conversation.id, MessageType.CUSTOMER, at(100));
      await seedMessage(conversation.id, MessageType.SYSTEM, at(101));
      await seedMessage(conversation.id, MessageType.TOOL, at(102));
      await seedMessage(conversation.id, MessageType.HUMAN_AGENT, at(130));
      // Turn 3: still waiting, not counted.
      await seedMessage(conversation.id, MessageType.CUSTOMER, at(200));

      const result = await analytics.getResponseTimeAnalytics({ organizationId: orgId });
      expect(result.sampleSize).toBe(2);
      expect(result.averageResponseTime).toBeCloseTo(20);
      expect(result.medianResponseTime).toBeCloseTo(20);
    });

    it("ignores blocked drafts", async () => {
      const conversation = await seedConversation();
      await seedMessage(conversation.id, MessageType.CUSTOMER, at(0));
      await seedMessage(conversation.id, MessageType.BOT_AGENT, at(2), {
        deliveryState: DeliveryState.BLOCKED,
      });
      await seedMessage(conversation.id, MessageType.HUMAN_AGENT, at(60));

      const result = await analytics.getResponseTimeAnalytics({ organizationId: orgId });
      expect(result.sampleSize).toBe(1);
      expect(result.averageResponseTime).toBeCloseTo(60);
    });

    it("filters by the customer message date and skips deleted conversations", async () => {
      const kept = await seedConversation();
      await seedMessage(kept.id, MessageType.CUSTOMER, at(0));
      await seedMessage(kept.id, MessageType.BOT_AGENT, at(4));

      const old = await seedConversation();
      await seedMessage(old.id, MessageType.CUSTOMER, new Date("2026-09-01T00:00:00Z"));
      await seedMessage(old.id, MessageType.BOT_AGENT, new Date("2026-09-01T00:10:00Z"));

      const deleted = await seedConversation();
      await seedMessage(deleted.id, MessageType.CUSTOMER, at(0));
      await seedMessage(deleted.id, MessageType.BOT_AGENT, at(500));
      await AppDataSource.getRepository(Conversation).update(
        { id: deleted.id },
        { deleted_at: new Date() },
      );

      const result = await analytics.getResponseTimeAnalytics({
        organizationId: orgId,
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: new Date("2026-10-31T23:59:59Z"),
      });
      expect(result.sampleSize).toBe(1);
      expect(result.averageResponseTime).toBeCloseTo(4);
    });
  });

  describe("getAgentPerformance", () => {
    it("computes the real resolution rate per agent, busiest first", async () => {
      await seedConversation({ agent_id: agentA, status: "resolved" });
      await seedConversation({ agent_id: agentA, status: "resolved" });
      await seedConversation({ agent_id: agentA, status: "open" });
      await seedConversation({ agent_id: agentB, status: "closed" });
      await seedConversation({ agent_id: null, status: "resolved" });
      await seedConversation({
        agent_id: agentB,
        status: "resolved",
        created_at: new Date("2026-09-01T00:00:00Z"),
      });

      const result = await analytics.getAgentPerformance({
        organizationId: orgId,
        startDate: new Date("2026-10-01T00:00:00Z"),
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        agentId: agentA,
        totalConversations: 3,
        resolvedConversations: 2,
      });
      expect(result[0].resolutionRate).toBeCloseTo(66.667, 2);
      expect(result[1]).toEqual({
        agentId: agentB,
        totalConversations: 1,
        resolvedConversations: 0,
        resolutionRate: 0,
      });
    });
  });
});
