import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageIntent, MessageType } from "../../database/entities/message.entity";

const mockInvokeWithMeta = jest.fn<(options: Record<string, unknown>) => Promise<unknown>>();
const mockEmbedPending = jest.fn<() => Promise<unknown[]>>();

jest.mock("../../services/core/llm.service", () => ({
  LLMService: jest.fn().mockImplementation(() => ({
    invokeWithMeta: (options: Record<string, unknown>) => mockInvokeWithMeta(options),
  })),
}));
jest.mock("../../services/insights/insight-embedding.service", () => ({
  insightEmbeddingService: { embedPending: () => mockEmbedPending() },
}));

import { InsightBackfillService } from "../../services/insights/insight-backfill.service";
import {
  getOrganizationThresholds,
  updateOrganizationThresholds,
} from "../../services/insights/insight-settings";

const RESPONSE = {
  is_spam: false,
  had_real_request: true,
  ai_resolved: false,
  outcome_reason: "No answer about Portugal.",
  summary: "Shopper asked about shipping to Portugal; write to jane@example.com",
  polarity: "negative",
  action_type: "knowledge_add",
  severity: "medium",
  confidence: 0.8,
  relevance: 60,
  root_cause: "No shipping document covers Portugal.",
  area: "shipping",
  snippet: "Do you ship to Portugal?",
  paraphrase: "Ships to Portugal?",
};

describe("insights backfill and tuning hooks (D3-18)", () => {
  const orgId = "d3180000-0000-4000-8000-000000000001";
  const service = new InsightBackfillService();
  const day = 86400000;

  async function closedConversation(
    closedDaysAgo: number,
    overrides: Partial<Conversation> = {},
    customerText = "Do you ship to Portugal?",
  ): Promise<Conversation> {
    const repo = AppDataSource.getRepository(Conversation);
    const conversation = await repo.save(
      repo.create({
        title: "backfill test",
        organization_id: orgId,
        status: "resolved",
        metadata: {},
        closed_at: new Date(Date.now() - closedDaysAgo * day),
        ...overrides,
      }),
    );
    const messages = AppDataSource.getRepository(Message);
    await messages.save(
      messages.create({
        conversation_id: conversation.id,
        type: MessageType.CUSTOMER,
        content: customerText,
        intent: customerText.length > 5 ? ("question" as Message["intent"]) : MessageIntent.GREET,
      }),
    );
    await messages.save(
      messages.create({
        conversation_id: conversation.id,
        type: MessageType.BOT_AGENT,
        content: "Let me check that for you.",
      }),
    );
    return conversation;
  }

  const cleanup = async () => {
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM insight_issues WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM insight_runs WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM insight_org_state WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(
      `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE organization_id = $1)`,
      [orgId],
    );
    await AppDataSource.query(`DELETE FROM conversation_outcomes WHERE organization_id = $1`, [
      orgId,
    ]);
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
  };

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(orgRepo.create({ id: orgId, name: "Backfill Org", slug: "backfill-org" }));
    }
  });

  beforeEach(async () => {
    await cleanup();
    mockInvokeWithMeta.mockReset();
    mockInvokeWithMeta.mockResolvedValue({
      content: JSON.stringify(RESPONSE),
      usage: { promptTokens: 500, cachedPromptTokens: 0, completionTokens: 120, totalTokens: 620 },
      model: "test-model",
    });
    mockEmbedPending.mockReset();
    mockEmbedPending.mockResolvedValue([]);
  });

  afterAll(async () => {
    await cleanup();
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("reviews the last 30 days of closes once, insights-only, in batches", async () => {
    const reviewed = [await closedConversation(3), await closedConversation(10)];
    await closedConversation(2, { metadata: { isPlayground: true } }); // test
    await closedConversation(4, { spam_flagged_at: new Date() }); // spam
    await closedConversation(45); // outside the window
    await closedConversation(5, {}, "hi"); // no real request
    await AppDataSource.getRepository(Conversation).save(
      AppDataSource.getRepository(Conversation).create({
        title: "open",
        organization_id: orgId,
        status: "open",
        metadata: {},
      }),
    );

    expect((await service.status(orgId)).running).toBe(false);
    await service.request(orgId);
    const firstRequest = (await service.status(orgId)).requestedAt;
    await service.request(orgId); // idempotent
    expect((await service.status(orgId)).requestedAt).toEqual(firstRequest);

    expect(await service.processPending(2)).toBe(1); // 10d (reviewed) + 5d (skipped)
    expect((await service.status(orgId)).running).toBe(true);
    expect(await service.processPending(2)).toBe(1); // 3d (reviewed) + 2d (test, skipped)
    expect(await service.processPending(2)).toBe(0); // nothing left: done
    const status = await service.status(orgId);
    expect(status).toMatchObject({ running: false, reviewed: 2 });
    expect(mockEmbedPending).toHaveBeenCalled();

    const issues: Array<{
      conversation_id: string;
      conversation_outcome_id: string | null;
      summary: string;
      signals: Record<string, unknown>;
    }> = await AppDataSource.query(
      `SELECT conversation_id, conversation_outcome_id, summary, signals FROM insight_issues
          WHERE organization_id = $1 ORDER BY created_at`,
      [orgId],
    );
    expect(issues.map((i) => i.conversation_id).sort()).toEqual(reviewed.map((c) => c.id).sort());
    expect(issues.every((i) => i.conversation_outcome_id === null)).toBe(true);
    expect(issues[0].signals).toMatchObject({ backfill: true, handedOff: false });
    expect(issues[0].summary).not.toContain("jane@example.com");

    // Never touches billing or status.
    const [{ count }] = await AppDataSource.query(
      `SELECT count(*)::int AS count FROM conversation_outcomes WHERE organization_id = $1`,
      [orgId],
    );
    expect(count).toBe(0);
    const [{ kind }] = await AppDataSource.query(
      `SELECT kind FROM insight_runs WHERE organization_id = $1 LIMIT 1`,
      [orgId],
    );
    expect(kind).toBe("backfill_review");

    // A finished backfill does not run again.
    mockInvokeWithMeta.mockClear();
    await service.request(orgId);
    expect(await service.processPending(10)).toBe(0);
    expect(mockInvokeWithMeta).not.toHaveBeenCalled();
  });

  it("keeps going when one review fails", async () => {
    await closedConversation(3);
    await closedConversation(2);
    mockInvokeWithMeta.mockRejectedValueOnce(new Error("provider down"));
    await service.request(orgId);
    expect(await service.processPending(10)).toBe(1);
    expect((await service.status(orgId)).running).toBe(false);
  });

  it("stores clamped per-org threshold overrides", async () => {
    const resolved = await updateOrganizationThresholds(orgId, {
      minClusterSize: 1,
      joinThreshold: 0.88,
      mergeThreshold: 0.8, // below join: raised to join
      digestEnabled: false,
    });
    expect(resolved).toMatchObject({
      minClusterSize: 2,
      joinThreshold: 0.88,
      mergeThreshold: 0.88,
      digestEnabled: false,
    });
    expect(await getOrganizationThresholds(orgId)).toMatchObject(resolved);
    await updateOrganizationThresholds(orgId, { minClusterSize: 7 });
    expect(await getOrganizationThresholds(orgId)).toMatchObject({
      minClusterSize: 7,
      digestEnabled: false,
    });
  });
});
