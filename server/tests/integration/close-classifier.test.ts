import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { ConversationOutcome } from "../../database/entities/conversation-outcome.entity";
import { InsightIssue } from "../../database/entities/insight-issue.entity";
import { Customer } from "../../database/entities/customer.entity";
import { User } from "../../entities/user.entity";
import { AnalyticsService } from "../../services/analytics.service";
import { ConversationRepository } from "../../repositories/conversation.repository";
import {
  closeClassifierService,
  MAX_ATTEMPTS,
} from "../../services/close-classification/close-classifier.service";
import { REVERSAL_WINDOW_MS } from "../../services/close-classification/outcome-rules";
import { markNotSpam } from "../../services/spam/spam-review.service";
import { AddConversationOutcomes1785100000000 } from "../../database/migrations/1785100000000-AddConversationOutcomes";

const mockInvokeWithMeta = jest.fn<(options: Record<string, unknown>) => Promise<unknown>>();

// The one LLM call is the boundary; everything else (repository hook, SQL,
// leasing, reversal) runs against the real test database.
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

const VALID_RESPONSE = {
  is_spam: false,
  had_real_request: true,
  ai_resolved: true,
  outcome_reason: "The AI gave the tracking link.",
  summary: "Customer asked where their order was; the AI shared tracking. Contact jane@example.com",
  polarity: "positive",
  action_type: "none",
  severity: "low",
  confidence: 0.9,
  relevance: 20,
  root_cause: "",
  area: "shipping",
  snippet: "Where is my order? Call me on +351 912 345 678",
  paraphrase: "Wants to know where the order is.",
};

function llmReturns(overrides: Partial<typeof VALID_RESPONSE> = {}) {
  mockInvokeWithMeta.mockResolvedValue({
    content: JSON.stringify({ ...VALID_RESPONSE, ...overrides }),
    usage: { promptTokens: 500, cachedPromptTokens: 0, completionTokens: 120, totalTokens: 620 },
    model: "test-model",
    provider: "test",
  });
}

describe("close classifier (D1-3 + D3-8)", () => {
  const orgId = "c105edc1-0000-4000-8000-000000000001";
  const staffUserId = "c105edc1-0000-4000-8000-0000000000aa";
  const analytics = new AnalyticsService();
  const repository = new ConversationRepository();
  const outcomes = () => AppDataSource.getRepository(ConversationOutcome);
  const issues = () => AppDataSource.getRepository(InsightIssue);

  const billable = async () =>
    (
      await analytics.getConversationMetrics({
        organizationId: orgId,
        startDate: new Date(Date.now() - 30 * 24 * 3600 * 1000),
        endDate: new Date(Date.now() + 24 * 3600 * 1000),
      })
    ).billableResolutions;

  /** An open conversation where the shopper asked and the AI answered. */
  async function conversationWithAnswer(
    overrides: Partial<Conversation> = {},
    aiReply = "It shipped yesterday, here is the tracking link.",
  ): Promise<Conversation> {
    const conversation = await repository.create({
      title: "close classifier test",
      organization_id: orgId,
      status: "open",
      metadata: {},
      ...overrides,
    });
    const messages = AppDataSource.getRepository(Message);
    await messages.save(
      messages.create({
        conversation_id: conversation.id,
        type: MessageType.CUSTOMER,
        content: "Where is my order?",
        intent: "question" as Message["intent"],
      }),
    );
    await messages.save(
      messages.create({
        conversation_id: conversation.id,
        type: MessageType.BOT_AGENT,
        content: aiReply,
      }),
    );
    return conversation;
  }

  const inactivityClose = (conversation: Conversation, silent = false) =>
    repository.update(conversation.id, orgId, {
      status: "resolved",
      ended_at: new Date(),
      resolution_metadata: {
        resolved: false,
        confidence: 1,
        reason: silent ? "inactivity_timeout_silent" : "inactivity_timeout",
      },
    });

  const outcomeFor = (conversationId: string) =>
    outcomes().findOneByOrFail({ conversation_id: conversationId });

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(
        orgRepo.create({ id: orgId, name: "Close Classifier Org", slug: "close-classifier-org" }),
      );
    }
    const userRepo = AppDataSource.getRepository(User);
    if (!(await userRepo.findOne({ where: { id: staffUserId } }))) {
      await userRepo.save(
        userRepo.create({ id: staffUserId, email: "close-classifier@example.com", password: "x" }),
      );
    }
  });

  beforeEach(async () => {
    mockInvokeWithMeta.mockReset();
    llmReturns();
    await issues().delete({ organization_id: orgId });
    await outcomes().delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Customer).delete({ organization_id: orgId });
  });

  afterAll(async () => {
    await issues().delete({ organization_id: orgId });
    await outcomes().delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Customer).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    await AppDataSource.getRepository(User).delete({ id: staffUserId });
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("records exactly one outcome per close, pending classification", async () => {
    const conversation = await conversationWithAnswer();
    await inactivityClose(conversation);
    // Re-saving the closed status or moving to another closed status is not a new close.
    await repository.update(conversation.id, orgId, { status: "resolved" });
    await repository.update(conversation.id, orgId, { status: "closed" });

    const rows = await outcomes().findBy({ conversation_id: conversation.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      close_status: "resolved",
      close_reason: "inactivity_timeout",
      classified_by: "rule",
      classified_at: null,
      outcome: "assumed",
      billable: true,
    });
  });

  it("silent close after a substantive answer: one LLM call writes the outcome and the QA event", async () => {
    const conversation = await conversationWithAnswer({ channel: "whatsapp" });
    await inactivityClose(conversation, true);

    expect(await closeClassifierService.processPending(10)).toBe(1);
    expect(mockInvokeWithMeta).toHaveBeenCalledTimes(1);
    expect(mockInvokeWithMeta.mock.calls[0][0]).toMatchObject({
      organizationId: orgId,
      tier: "medium",
    });

    const outcome = await outcomeFor(conversation.id);
    expect(outcome).toMatchObject({
      outcome: "assumed",
      billable: true,
      ai_resolved: true,
      classified_by: "llm",
      llm_model: "test-model",
    });
    expect(outcome.classified_at).toBeInstanceOf(Date);

    const issue = await issues().findOneByOrFail({ conversation_outcome_id: outcome.id });
    expect(issue).toMatchObject({
      source: "ai_review",
      polarity: "positive",
      action_type: "none",
      area: "shipping",
    });
    // Deterministic redaction runs on top of the prompt's privacy rule.
    expect(issue.summary).not.toContain("jane@example.com");
    expect(issue.snippet).not.toContain("912 345 678");
    expect(issue.enriched_at).toBeInstanceOf(Date);
    expect(issue.signals).toMatchObject({ outcome: "assumed", channel: "whatsapp" });

    expect(await billable()).toBe(1);
    const reloaded = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });
    expect(reloaded.status).toBe("resolved");
  });

  it("is idempotent: re-running and racing workers never double-write", async () => {
    const conversation = await conversationWithAnswer();
    await inactivityClose(conversation);

    await Promise.all([
      closeClassifierService.processPending(10),
      closeClassifierService.processPending(10),
    ]);
    const outcome = await outcomeFor(conversation.id);
    await closeClassifierService.classify(outcome.id, 1);
    await closeClassifierService.processPending(10);

    expect(mockInvokeWithMeta).toHaveBeenCalledTimes(1);
    expect(await issues().countBy({ organization_id: orgId })).toBe(1);
    expect(await billable()).toBe(1);
  });

  it("bills a handed-off conversation when the AI resolved it", async () => {
    const conversation = await conversationWithAnswer();
    await repository.update(conversation.id, orgId, { status: "pending-human" });
    await repository.update(conversation.id, orgId, { status: "open" });
    await repository.update(conversation.id, orgId, {
      status: "resolved",
      ended_at: new Date(),
      resolution_metadata: {
        resolved: true,
        confidence: 1,
        reason: "user_indicated_close_satisfied",
      },
    });

    // Before the LLM runs, the rule never bills a hand-off.
    expect((await outcomeFor(conversation.id)).billable).toBe(false);

    llmReturns({ ai_resolved: true });
    await closeClassifierService.processPending(10);
    expect(await outcomeFor(conversation.id)).toMatchObject({
      outcome: "confirmed",
      billable: true,
      handed_off: true,
    });
    expect(await billable()).toBe(1);
  });

  it("does not bill a hand-off the human resolved", async () => {
    const conversation = await conversationWithAnswer();
    await repository.update(conversation.id, orgId, { status: "human-took-over" });
    await repository.update(conversation.id, orgId, { status: "closed", closed_at: new Date() });

    llmReturns({ ai_resolved: false, polarity: "neutral", action_type: "support_training" });
    await closeClassifierService.processPending(10);
    expect(await outcomeFor(conversation.id)).toMatchObject({ outcome: "human", billable: false });
    expect(await billable()).toBe(0);
    // Staff closes keep their status.
    const reloaded = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });
    expect(reloaded.status).toBe("closed");
  });

  it("moves an abandoned inactivity close to unresolved and does not bill it", async () => {
    const conversation = await conversationWithAnswer();
    await inactivityClose(conversation);

    llmReturns({
      ai_resolved: false,
      polarity: "negative",
      action_type: "knowledge_add",
      relevance: 40,
    });
    await closeClassifierService.processPending(10);

    expect(await outcomeFor(conversation.id)).toMatchObject({
      outcome: "abandoned",
      billable: false,
    });
    const reloaded = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });
    expect(reloaded.status).toBe("unresolved");
    expect((await issues().findOneByOrFail({ conversation_id: conversation.id })).relevance).toBe(
      50,
    );
    expect(await billable()).toBe(0);
  });

  it("never re-closes a conversation the shopper reopened before classification", async () => {
    const conversation = await conversationWithAnswer();
    await inactivityClose(conversation);
    await repository.update(conversation.id, orgId, { status: "open" });

    llmReturns({ ai_resolved: false });
    await closeClassifierService.processPending(10);
    const reloaded = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });
    expect(reloaded.status).toBe("open");
  });

  it("an unhappy close gets the unresolved status and is never billed", async () => {
    const conversation = await conversationWithAnswer();
    await repository.update(conversation.id, orgId, {
      status: "unresolved",
      ended_at: new Date(),
      resolution_metadata: {
        resolved: false,
        confidence: 1,
        reason: "user_indicated_close_unsatisfied",
      },
    });
    llmReturns({ ai_resolved: true });
    await closeClassifierService.processPending(10);
    expect(await outcomeFor(conversation.id)).toMatchObject({
      close_status: "unresolved",
      outcome: "unhappy",
      billable: false,
    });
    expect(await billable()).toBe(0);
  });

  describe("72 h reversal", () => {
    it("bills a silent close, then reverses it when the shopper returns in the same conversation", async () => {
      const conversation = await conversationWithAnswer();
      await inactivityClose(conversation, true);
      await closeClassifierService.processPending(10);
      expect(await billable()).toBe(1);

      const live = await repository.findById(conversation.id);
      await live!.addMessage({ content: "It still hasn't arrived", type: MessageType.CUSTOMER });

      const outcome = await outcomeFor(conversation.id);
      expect(outcome.reversed_at).toBeInstanceOf(Date);
      expect(outcome.reversal_reason).toBe("shopper_returned");
      expect(await billable()).toBe(0);
    });

    it("reverses when the same customer opens a new conversation within 72 h", async () => {
      const customer = await AppDataSource.getRepository(Customer).save(
        AppDataSource.getRepository(Customer).create({
          organization_id: orgId,
          external_id: "shopper-1",
        }),
      );
      const first = await conversationWithAnswer({ customer_id: customer.id });
      await inactivityClose(first, true);
      await closeClassifierService.processPending(10);

      const second = await repository.create({
        title: "second",
        organization_id: orgId,
        status: "open",
        customer_id: customer.id,
      });
      const live = await repository.findById(second.id);
      await live!.addMessage({ content: "Hi again, one more thing", type: MessageType.CUSTOMER });

      expect((await outcomeFor(first.id)).reversal_reason).toBe(
        "shopper_returned_new_conversation",
      );
      expect(await billable()).toBe(0);
    });

    it("keeps the charge when the shopper returns after 72 h", async () => {
      const conversation = await conversationWithAnswer();
      await inactivityClose(conversation, true);
      await closeClassifierService.processPending(10);
      const outcome = await outcomeFor(conversation.id);
      await outcomes().update(
        { id: outcome.id },
        { closed_at: new Date(Date.now() - REVERSAL_WINDOW_MS - 60_000) },
      );

      const live = await repository.findById(conversation.id);
      await live!.addMessage({ content: "New question about sizes", type: MessageType.CUSTOMER });

      expect((await outcomes().findOneByOrFail({ id: outcome.id })).reversed_at).toBeNull();
      expect(
        await repository.countBillableResolutions({
          organizationId: orgId,
          startDate: new Date(Date.now() - 30 * 24 * 3600 * 1000),
        }),
      ).toBe(1);
    });
  });

  it("spam is never billed: flagged before close (no LLM call) or found by the classifier", async () => {
    const flagged = await conversationWithAnswer({
      spam_flagged_at: new Date(),
      spam_reason: "detector",
    });
    await inactivityClose(flagged);
    const found = await conversationWithAnswer();
    await inactivityClose(found);

    llmReturns({ is_spam: true });
    await closeClassifierService.processPending(10);

    expect(mockInvokeWithMeta).toHaveBeenCalledTimes(1);
    expect(await outcomeFor(flagged.id)).toMatchObject({ outcome: "spam", billable: false });
    expect(await outcomeFor(found.id)).toMatchObject({
      outcome: "spam",
      billable: false,
      classified_by: "llm",
    });
    const reloaded = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: found.id,
    });
    expect(reloaded.spam_flagged_at).toBeInstanceOf(Date);
    expect(reloaded.spam_reason).toBe("close_classifier");
    // No QA event for spam.
    expect(await issues().countBy({ organization_id: orgId })).toBe(0);
    expect(await billable()).toBe(0);
  });

  it("Not spam undoes spam the classifier found: reclassified, and the model's spam no longer counts", async () => {
    const found = await conversationWithAnswer();
    await inactivityClose(found);
    llmReturns({ is_spam: true });
    await closeClassifierService.processPending(10);
    expect(await outcomeFor(found.id)).toMatchObject({ outcome: "spam", classified_by: "llm" });

    await markNotSpam(orgId, found.id, staffUserId);
    const cleared = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: found.id,
    });
    expect(cleared.spam_flagged_at).toBeNull();
    expect(await outcomeFor(found.id)).toMatchObject({ classified_at: null });

    // The model says spam again; staff's verdict wins.
    await closeClassifierService.processPending(10);
    expect(await outcomeFor(found.id)).toMatchObject({
      outcome: "assumed",
      billable: true,
      classified_by: "llm",
    });
    const after = await AppDataSource.getRepository(Conversation).findOneByOrFail({ id: found.id });
    expect(after.spam_flagged_at).toBeNull();
    expect(await billable()).toBe(1);
  });

  it("test traffic and greeting-only chats skip the LLM and never bill", async () => {
    const playground = await conversationWithAnswer({
      metadata: { sourceId: "playground", dryRun: true },
    });
    await inactivityClose(playground);

    const greeting = await repository.create({
      title: "hi",
      organization_id: orgId,
      status: "open",
    });
    await AppDataSource.getRepository(Message).save({
      conversation_id: greeting.id,
      type: MessageType.CUSTOMER,
      content: "hi",
      intent: "greet" as Message["intent"],
    });
    await inactivityClose(greeting, true);

    await closeClassifierService.processPending(10);
    expect(mockInvokeWithMeta).not.toHaveBeenCalled();
    expect(await outcomeFor(playground.id)).toMatchObject({ outcome: "test", billable: false });
    expect(await outcomeFor(greeting.id)).toMatchObject({ outcome: "abandoned", billable: false });
    const reloaded = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: greeting.id,
    });
    expect(reloaded.status).toBe("unresolved");
    expect(await billable()).toBe(0);
  });

  it("LLM failure: retries, then keeps the rule outcome and writes no QA event", async () => {
    const answered = await conversationWithAnswer();
    await inactivityClose(answered);
    const handedOff = await conversationWithAnswer();
    await repository.update(handedOff.id, orgId, { status: "pending-human" });
    await repository.update(handedOff.id, orgId, { status: "open" });
    await inactivityClose(handedOff);

    mockInvokeWithMeta.mockRejectedValue(new Error("provider down"));
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await closeClassifierService.processPending(10);
      if (attempt < MAX_ATTEMPTS) {
        const pending = await outcomeFor(answered.id);
        expect(pending.classified_at).toBeNull();
        expect(pending.last_error).toBe("provider down");
        expect(pending.claimed_until!.getTime()).toBeGreaterThan(Date.now());
        // Skip the backoff.
        await outcomes().update(
          { organization_id: orgId },
          { claimed_until: new Date(Date.now() - 1000) },
        );
      }
    }

    expect(mockInvokeWithMeta).toHaveBeenCalledTimes(MAX_ATTEMPTS * 2);
    expect(await outcomeFor(answered.id)).toMatchObject({
      classified_by: "rule",
      outcome: "assumed",
      billable: true,
      attempts: MAX_ATTEMPTS,
    });
    expect(await outcomeFor(handedOff.id)).toMatchObject({
      classified_by: "rule",
      outcome: "human",
      billable: false,
    });
    expect(await issues().countBy({ organization_id: orgId })).toBe(0);
    expect(await billable()).toBe(1);
  });

  it("counts by close time and keeps billed resolutions when the conversation is deleted", async () => {
    const conversation = await conversationWithAnswer();
    await inactivityClose(conversation);
    await closeClassifierService.processPending(10);
    await repository.update(conversation.id, orgId, { deleted_at: new Date() });
    expect(await billable()).toBe(1);

    const outcome = await outcomeFor(conversation.id);
    expect(
      await repository.countBillableResolutions({
        organizationId: orgId,
        startDate: new Date(outcome.closed_at.getTime() + 1000),
      }),
    ).toBe(0);
  });

  it("migration backfills historic resolved conversations with the Wave 0 rule", async () => {
    const repo = AppDataSource.getRepository(Conversation);
    const seed = (overrides: Partial<Conversation>) =>
      repo.save(
        repo.create({
          title: "historic",
          organization_id: orgId,
          status: "resolved",
          ended_at: new Date(),
          metadata: {},
          ...overrides,
        }),
      );
    const reason = (r: string) => ({ resolved: false, confidence: 1, reason: r });
    const satisfied = await seed({ resolution_metadata: reason("user_indicated_close_satisfied") });
    const inactive = await seed({ resolution_metadata: reason("inactivity_timeout") });
    const unhappy = await seed({ resolution_metadata: reason("user_indicated_close_unsatisfied") });
    const handedOff = await seed({
      handed_off_at: new Date(),
      resolution_metadata: reason("inactivity_timeout"),
    });
    const test = await seed({ metadata: { isPlayground: true } });
    const open = await seed({ status: "open", ended_at: null });

    const queryRunner = AppDataSource.createQueryRunner();
    try {
      await new AddConversationOutcomes1785100000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    const outcomeOf = async (c: Conversation) =>
      (await outcomes().findOneBy({ conversation_id: c.id }))?.outcome;
    expect(await outcomeOf(satisfied)).toBe("confirmed");
    expect(await outcomeOf(inactive)).toBe("assumed");
    expect(await outcomeOf(unhappy)).toBe("unhappy");
    expect(await outcomeOf(handedOff)).toBe("human");
    expect(await outcomeOf(test)).toBe("test");
    expect(await outcomeOf(open)).toBeUndefined();
    expect(await billable()).toBe(2);
    // Backfilled rows are final: no LLM cost for history.
    expect(await closeClassifierService.processPending(10)).toBe(0);
  });
});
