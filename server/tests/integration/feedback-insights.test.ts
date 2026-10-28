import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { MessageFeedback } from "../../database/entities/message-feedback.entity";
import { InsightIssue } from "../../database/entities/insight-issue.entity";
import { ConversationRepository } from "../../repositories/conversation.repository";
import {
  FeedbackMessageNotFoundError,
  MessageFeedbackService,
} from "../../services/message-feedback.service";
import {
  ENRICH_MAX_ATTEMPTS,
  feedbackInsightService,
} from "../../services/insights/feedback-insight.service";
import { FeedbackRating } from "../../types/message-feedback.types";

const mockInvokeWithMeta = jest.fn<(options: Record<string, unknown>) => Promise<unknown>>();

// The enrichment LLM call is the boundary; SQL, leasing and the feedback
// transaction run against the real test database.
jest.mock("../../services/core/llm.service", () => ({
  LLMService: jest.fn().mockImplementation(() => ({
    invokeWithMeta: (options: Record<string, unknown>) => mockInvokeWithMeta(options),
    invoke: jest.fn(),
  })),
}));
jest.mock("../../services/conversation-events.service", () => ({
  conversationEventsService: {
    broadcastConversationCreated: jest.fn(),
    broadcastConversationUpdated: jest.fn(),
    broadcastMessageReceived: jest.fn(),
  },
}));
jest.mock("../../services/conversation-alert.service", () => ({
  conversationAlertService: { onConversationStatusChanged: jest.fn() },
}));
jest.mock("../../services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: jest.fn() },
}));

const ENRICHMENT = {
  summary: "Customer asked about delivery to Portugal; the AI said it does not ship there.",
  detail: "The reply contradicts the shipping policy. Write to jane@example.com for details.",
  action_type: "knowledge_edit",
  severity: "high",
  confidence: 0.8,
  relevance: 50,
  root_cause: "The shipping document lists old countries.",
  area: "shipping",
  paraphrase: "Wants to know if the store ships to Portugal.",
};

function llmReturns(overrides: Record<string, unknown> = {}) {
  mockInvokeWithMeta.mockResolvedValue({
    content: JSON.stringify({ ...ENRICHMENT, ...overrides }),
    usage: { promptTokens: 300, cachedPromptTokens: 0, completionTokens: 90, totalTokens: 390 },
    model: "easy-model",
    provider: "test",
  });
}

describe("feedback → insight issues (D3-9)", () => {
  const orgId = "d3900000-0000-4000-8000-000000000001";
  const otherOrgId = "d3900000-0000-4000-8000-000000000002";
  const reviewerId = "d3900000-0000-4000-8000-0000000000aa";
  const repository = new ConversationRepository();
  const feedbackService = new MessageFeedbackService();
  const issues = () => AppDataSource.getRepository(InsightIssue);

  /** A conversation in `org` with a customer question and an AI reply; returns the reply. */
  async function ratedReply(org = orgId): Promise<Message> {
    const conversation = await repository.create({
      title: "feedback insights test",
      organization_id: org,
      status: "open",
      metadata: {},
    });
    const messages = AppDataSource.getRepository(Message);
    await messages.save(
      messages.create({
        conversation_id: conversation.id,
        type: MessageType.CUSTOMER,
        content: "Do you ship to Portugal? I'm on +351 912 345 678",
      }),
    );
    return messages.save(
      messages.create({
        conversation_id: conversation.id,
        type: MessageType.BOT_AGENT,
        content: "Sorry, we do not ship to Portugal. Contact jane@example.com",
      }),
    );
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "feedback-insights-org"],
      [otherOrgId, "feedback-insights-other"],
    ]) {
      if (!(await orgs.findOne({ where: { id } }))) {
        await orgs.save(orgs.create({ id, name: slug, slug }));
      }
    }
    const users = AppDataSource.getRepository(User);
    if (!(await users.findOne({ where: { id: reviewerId } }))) {
      await users.save(
        users.create({
          id: reviewerId,
          email: "reviewer@feedback-insights.test",
          password: "x",
        } as Partial<User>),
      );
    }
  });

  beforeEach(async () => {
    mockInvokeWithMeta.mockReset();
    for (const org of [orgId, otherOrgId]) {
      await issues().delete({ organization_id: org });
      await AppDataSource.getRepository(MessageFeedback).delete({ organizationId: org });
      await AppDataSource.getRepository(Conversation).delete({ organization_id: org });
    }
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      await issues().delete({ organization_id: org });
      await AppDataSource.getRepository(MessageFeedback).delete({ organizationId: org });
      await AppDataSource.getRepository(Conversation).delete({ organization_id: org });
      await AppDataSource.getRepository(Organization).delete({ id: org });
    }
    await AppDataSource.getRepository(User).delete({ id: reviewerId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("every rating creates one pending, redacted issue in the same transaction", async () => {
    const reply = await ratedReply();
    const feedback = await feedbackService.createFeedback(orgId, reviewerId, {
      messageId: reply.id,
      rating: FeedbackRating.BAD,
      comment: "Wrong, we ship to PT. Ask maria@example.com",
    });

    const issue = await issues().findOneByOrFail({ message_feedback_id: feedback.id });
    expect(issue).toMatchObject({
      organization_id: orgId,
      source: "user_feedback",
      conversation_id: reply.conversation_id,
      message_id: reply.id,
      polarity: "negative",
      enriched_at: null,
      relevance: 30,
    });
    expect(issue.summary).not.toContain("maria@example.com");
    expect(issue.snippet).not.toContain("jane@example.com");
    expect(issue.signals).toMatchObject({ rating: "bad", hasComment: true });
  });

  it("refuses a rating of another organization's message, and writes nothing", async () => {
    const foreign = await ratedReply(otherOrgId);
    await expect(
      feedbackService.createFeedback(orgId, reviewerId, {
        messageId: foreign.id,
        rating: FeedbackRating.GOOD,
      }),
    ).rejects.toBeInstanceOf(FeedbackMessageNotFoundError);
    expect(
      await AppDataSource.getRepository(MessageFeedback).countBy({ messageId: foreign.id }),
    ).toBe(0);
  });

  it("enriches with one easy-tier call over the conversation, in the owner's language", async () => {
    const reply = await ratedReply();
    const feedback = await feedbackService.createFeedback(orgId, reviewerId, {
      messageId: reply.id,
      rating: FeedbackRating.BAD,
    });
    llmReturns();

    const runs = await feedbackInsightService.enrichPending(5);
    expect(runs.filter((r) => r.organizationId === orgId)).toEqual([
      expect.objectContaining({ succeeded: true, model: "easy-model" }),
    ]);
    expect(mockInvokeWithMeta).toHaveBeenCalledTimes(1);
    const call = mockInvokeWithMeta.mock.calls[0][0];
    expect(call.tier).toBe("easy");
    expect(String(call.prompt)).toContain("Do you ship to Portugal?");
    expect(String(call.prompt)).toContain("RATING: bad");

    const issue = await issues().findOneByOrFail({ message_feedback_id: feedback.id });
    expect(issue.enriched_at).toBeInstanceOf(Date);
    expect(issue.action_type).toBe("knowledge_edit");
    expect(issue.severity).toBe("high");
    expect(issue.detail).toContain("contradicts the shipping policy");
    expect(issue.detail).not.toContain("jane@example.com");
    expect(issue.relevance).toBe(90); // 50 + thumbs-down 30 + knowledge gap 10

    // Nothing pending: no second call.
    await feedbackInsightService.enrichPending(5);
    expect(mockInvokeWithMeta).toHaveBeenCalledTimes(1);
  });

  it("after repeated LLM failures keeps the bare issue instead of losing the rating", async () => {
    const reply = await ratedReply();
    const feedback = await feedbackService.createFeedback(orgId, reviewerId, {
      messageId: reply.id,
      rating: FeedbackRating.GOOD,
    });
    mockInvokeWithMeta.mockRejectedValue(new Error("provider down"));
    const issue = await issues().findOneByOrFail({ message_feedback_id: feedback.id });

    for (let attempt = 1; attempt < ENRICH_MAX_ATTEMPTS; attempt++) {
      await feedbackInsightService.enrich(issue.id, attempt);
      expect((await issues().findOneByOrFail({ id: issue.id })).enriched_at).toBeNull();
    }
    await feedbackInsightService.enrich(issue.id, ENRICH_MAX_ATTEMPTS);
    const final = await issues().findOneByOrFail({ id: issue.id });
    expect(final.enriched_at).toBeInstanceOf(Date);
    expect(final.polarity).toBe("positive");
    expect(final.detail).toBeNull();
    expect(final.enrich_last_error).toBe("provider down");
  });

  it("survives the message being deleted, but goes when the rating is withdrawn", async () => {
    const reply = await ratedReply();
    const kept = await feedbackService.createFeedback(orgId, reviewerId, {
      messageId: reply.id,
      rating: FeedbackRating.BAD,
    });
    const keptIssue = await issues().findOneByOrFail({ message_feedback_id: kept.id });
    await AppDataSource.getRepository(Message).delete({ id: reply.id });
    expect(await issues().findOneByOrFail({ id: keptIssue.id })).toMatchObject({
      message_id: null,
      message_feedback_id: null,
    });

    const other = await ratedReply();
    const withdrawn = await feedbackService.createFeedback(orgId, reviewerId, {
      messageId: other.id,
      rating: FeedbackRating.BAD,
    });
    await feedbackService.deleteFeedback(withdrawn.id);
    expect(await issues().countBy({ message_feedback_id: withdrawn.id })).toBe(0);
  });

  it("backfills ratings saved before D3-9, once", async () => {
    const reply = await ratedReply();
    const repo = AppDataSource.getRepository(MessageFeedback);
    const old = await repo.save(
      repo.create({
        messageId: reply.id,
        organizationId: orgId,
        reviewerId,
        rating: FeedbackRating.NEUTRAL,
        comment: null,
      }),
    );
    // A legacy rating of another org's message is skipped.
    const foreign = await ratedReply(otherOrgId);
    await repo.save(
      repo.create({
        messageId: foreign.id,
        organizationId: orgId,
        reviewerId,
        rating: FeedbackRating.BAD,
        comment: null,
      }),
    );

    expect(await feedbackInsightService.backfillMissing({ organizationId: orgId })).toEqual({
      created: 1,
      skipped: 1,
    });
    expect(await issues().findOneByOrFail({ message_feedback_id: old.id })).toMatchObject({
      polarity: "neutral",
      enriched_at: null,
    });
    expect(await feedbackInsightService.backfillMissing({ organizationId: orgId })).toEqual({
      created: 0,
      skipped: 1,
    });
  });
});
