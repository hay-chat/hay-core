import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { InsightIssue } from "../../database/entities/insight-issue.entity";

jest.mock("../../services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: jest.fn(async () => true) },
}));
jest.mock("../../services/core/llm.service", () => ({
  LLMService: jest.fn().mockImplementation(() => ({ invoke: jest.fn() })),
}));

import { testCaseService } from "../../services/simulation/test-case.service";
import { replayService } from "../../services/simulation/replay.service";

/** D3-17: "save as test" from an Insight issue and the conversations behind an Insight. */
describe("insight test cases and replays", () => {
  const orgId = "d3170000-0000-4000-8000-000000000001";
  const otherOrgId = "d3170000-0000-4000-8000-000000000002";
  let clusterId: string;
  let issueId: string;
  let conversationId: string;
  let playgroundId: string;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "d317-org"],
      [otherOrgId, "d317-other"],
    ]) {
      if (!(await orgs.findOne({ where: { id } }))) {
        await orgs.save(orgs.create({ id, name: slug, slug }));
      }
    }

    const conversations = AppDataSource.getRepository(Conversation);
    const base = { organization_id: orgId, channel: "web", status: "closed" as const, context: {} };
    const conversation = await conversations.save({ ...base, title: "Return", metadata: {} });
    const playground = await conversations.save({
      ...base,
      title: "Playground",
      metadata: { isPlayground: true },
    });
    conversationId = conversation.id;
    playgroundId = playground.id;

    const messages = AppDataSource.getRepository(Message);
    const at = Date.now() - 60_000;
    await messages.insert({
      conversation_id: conversation.id,
      content: "Can I return worn shoes?",
      type: MessageType.CUSTOMER,
      created_at: new Date(at),
    });
    const reply = await messages.save({
      conversation_id: conversation.id,
      content: "Yes, any time.",
      type: MessageType.BOT_AGENT,
      created_at: new Date(at + 1),
    });

    const issues = AppDataSource.getRepository(InsightIssue);
    const common = {
      organization_id: orgId,
      source: "ai_review" as const,
      polarity: "negative" as const,
      action_type: "playbook_edit" as const,
      severity: "high" as const,
      confidence: 0.9,
      relevance: 5,
    };
    const issue = await issues.save({
      ...common,
      conversation_id: conversation.id,
      message_id: reply.id,
      summary: "Promised returns on worn items",
    });
    const playgroundIssue = await issues.save({
      ...common,
      conversation_id: playground.id,
      summary: "Playground noise",
    });
    issueId = issue.id;

    const [cluster] = await AppDataSource.query(
      `INSERT INTO insight_clusters (organization_id, polarity, action_type, signature)
       VALUES ($1, 'negative', 'playbook_edit', 'd317') RETURNING id`,
      [orgId],
    );
    clusterId = cluster.id;
    for (const id of [issue.id, playgroundIssue.id]) {
      await AppDataSource.query(
        `INSERT INTO insight_cluster_members (insight_issue_id, cluster_id, organization_id)
         VALUES ($1, $2, $3)`,
        [id, clusterId, orgId],
      );
    }
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      await AppDataSource.query(`DELETE FROM test_cases WHERE organization_id = $1`, [id]);
      await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = $1`, [id]);
      await AppDataSource.query(`DELETE FROM insight_issues WHERE organization_id = $1`, [id]);
      await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [id]);
      await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [id]);
    }
    await AppDataSource.destroy();
  });

  it("saves the history up to the flagged reply, with the problem to avoid", async () => {
    const testCase = await testCaseService.createFromInsightIssue(orgId, issueId);
    expect(testCase.source).toBe("insight");
    expect(testCase.source_ref).toBe(`insight_issue:${issueId}`);
    expect(testCase.title).toBe("Promised returns on worn items");
    expect(testCase.seed).toEqual([{ role: "customer", text: "Can I return worn shoes?" }]);
    expect(testCase.expectations).toEqual({
      expectedOutcome: "The reply must not repeat this problem: Promised returns on worn items",
      avoidReply: "Yes, any time.",
    });
    await expect(testCaseService.createFromInsightIssue(otherOrgId, issueId)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });

  it("lists the real conversations behind an insight, in its organization only", async () => {
    const ids = await replayService.insightConversationIds(orgId, clusterId, 20);
    expect(ids).toEqual([conversationId]);
    expect(ids).not.toContain(playgroundId);
    expect(await replayService.insightConversationIds(otherOrgId, clusterId, 20)).toEqual([]);
  });
});
