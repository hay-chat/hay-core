import { describe, it, expect } from "@jest/globals";
import {
  assessByRule,
  collectCloseFacts,
  computeRelevance,
  decideOutcome,
  isTestConversation,
  needsClassifier,
  type CloseFacts,
} from "../../services/close-classification/outcome-rules";
import {
  buildTranscript,
  parseClassifierResponse,
} from "../../services/close-classification/close-classifier.service";
import { MessageType, type Message } from "../../database/entities/message.entity";

let clock = Date.parse("2026-10-20T10:00:00Z");
function msg(type: MessageType, content: string, extra: Partial<Message> = {}): Message {
  clock += 1000;
  return {
    type,
    content,
    intent: null,
    sender: null,
    metadata: null,
    created_at: new Date(clock),
    ...extra,
  } as Message;
}

const baseFacts: CloseFacts = {
  closeReason: "inactivity_timeout",
  isTest: false,
  spamFlagged: false,
  handedOff: false,
  hadRealRequest: true,
  aiReplied: true,
  aiLastReplyIsAnswer: true,
  approvalRequested: false,
};

const verdict = (
  aiResolved: boolean,
  extra: Partial<{ isSpam: boolean; hadRealRequest: boolean }> = {},
) => ({
  isSpam: false,
  hadRealRequest: true,
  aiResolved,
  ...extra,
});

describe("close outcome rules", () => {
  describe("decideOutcome", () => {
    it("bills a silent close after an AI answer as assumed", () => {
      expect(decideOutcome(baseFacts, verdict(true))).toEqual({
        outcome: "assumed",
        billable: true,
        aiResolved: true,
      });
    });

    it("bills a shopper-confirmed AI resolution as confirmed", () => {
      const facts = { ...baseFacts, closeReason: "user_indicated_close_satisfied" };
      expect(decideOutcome(facts, verdict(true)).outcome).toBe("confirmed");
      const thanks = { ...baseFacts, closeReason: "user_indicated_greet" };
      expect(decideOutcome(thanks, verdict(true)).outcome).toBe("confirmed");
    });

    it("bills a hand-off when the AI resolved it", () => {
      const facts = { ...baseFacts, handedOff: true };
      expect(decideOutcome(facts, verdict(true))).toMatchObject({
        outcome: "assumed",
        billable: true,
      });
    });

    it("does not bill a hand-off the human resolved", () => {
      const facts = { ...baseFacts, handedOff: true };
      expect(decideOutcome(facts, verdict(false))).toMatchObject({
        outcome: "human",
        billable: false,
      });
    });

    it("does not bill when the AI did not resolve it", () => {
      expect(decideOutcome(baseFacts, verdict(false))).toMatchObject({
        outcome: "abandoned",
        billable: false,
      });
    });

    it("bills a conversation where the AI requested an approval, whatever came after", () => {
      const facts = { ...baseFacts, approvalRequested: true, handedOff: true };
      expect(decideOutcome(facts, verdict(false))).toEqual({
        outcome: "assumed",
        billable: true,
        aiResolved: true,
      });
      const unhappy = { ...facts, closeReason: "user_indicated_close_unsatisfied" };
      expect(decideOutcome(unhappy, verdict(false)).billable).toBe(false);
      const test = { ...facts, isTest: true };
      expect(decideOutcome(test, verdict(false)).outcome).toBe("test");
    });

    it("an unhappy close is never billed, whatever the model says", () => {
      const facts = { ...baseFacts, closeReason: "user_indicated_close_unsatisfied" };
      expect(decideOutcome(facts, verdict(true))).toMatchObject({
        outcome: "unhappy",
        billable: false,
      });
    });

    it("spam is never billed, flagged or found by the model", () => {
      expect(decideOutcome({ ...baseFacts, spamFlagged: true }, verdict(true)).outcome).toBe(
        "spam",
      );
      expect(decideOutcome(baseFacts, verdict(true, { isSpam: true }))).toMatchObject({
        outcome: "spam",
        billable: false,
      });
    });

    it("test traffic is never billed and wins over everything", () => {
      const facts = { ...baseFacts, isTest: true, spamFlagged: true };
      expect(decideOutcome(facts, verdict(true))).toMatchObject({
        outcome: "test",
        billable: false,
      });
    });

    it("no real request is abandoned, even if the model thinks the AI resolved it", () => {
      expect(decideOutcome({ ...baseFacts, hadRealRequest: false }, verdict(true)).outcome).toBe(
        "abandoned",
      );
      expect(decideOutcome(baseFacts, verdict(true, { hadRealRequest: false })).outcome).toBe(
        "abandoned",
      );
    });
  });

  describe("assessByRule (LLM-failure default)", () => {
    it("never bills a handed-off conversation", () => {
      const facts = { ...baseFacts, handedOff: true };
      expect(decideOutcome(facts, assessByRule(facts)).billable).toBe(false);
    });

    it("bills a silent close only when the AI's last reply is an answer", () => {
      expect(decideOutcome(baseFacts, assessByRule(baseFacts)).outcome).toBe("assumed");
      const question = { ...baseFacts, aiLastReplyIsAnswer: false };
      expect(decideOutcome(question, assessByRule(question)).outcome).toBe("abandoned");
    });

    it("a confirmed close bills even when the AI's last reply was a question", () => {
      const facts = {
        ...baseFacts,
        closeReason: "user_indicated_close_satisfied",
        aiLastReplyIsAnswer: false,
      };
      expect(decideOutcome(facts, assessByRule(facts)).outcome).toBe("confirmed");
    });

    it("does not bill when the AI never replied", () => {
      const facts = { ...baseFacts, aiReplied: false, aiLastReplyIsAnswer: false };
      expect(decideOutcome(facts, assessByRule(facts)).billable).toBe(false);
    });
  });

  describe("collectCloseFacts", () => {
    const conversation = {
      resolution_metadata: { resolved: false, confidence: 1, reason: "inactivity_timeout" },
      metadata: {},
      handed_off_at: null,
      spam_flagged_at: null,
    };

    it("notes a requested approval from the TOOL message", () => {
      const facts = collectCloseFacts(conversation, [
        msg(MessageType.CUSTOMER, "Please refund order 1001, it arrived broken"),
        msg(MessageType.TOOL, "Approval requested: shop:create_refund", {
          metadata: { toolStatus: "PENDING_APPROVAL", pendingActionId: "pa-1" },
        }),
        msg(MessageType.BOT_AGENT, "I've requested the refund; the team will confirm here."),
      ]);
      expect(facts.approvalRequested).toBe(true);
    });

    it("treats a greeting and silence as no real request", () => {
      const facts = collectCloseFacts(conversation, [
        msg(MessageType.CUSTOMER, "hi", { intent: "greet" as Message["intent"] }),
        msg(MessageType.BOT_AGENT, "Hello! How can I help?"),
      ]);
      expect(facts.hadRealRequest).toBe(false);
      expect(needsClassifier(facts)).toBe(false);
    });

    it("ignores inactivity warnings and closing lines when judging the AI's last reply", () => {
      const facts = collectCloseFacts(conversation, [
        msg(MessageType.CUSTOMER, "Where is my order?", {
          intent: "question" as Message["intent"],
        }),
        msg(MessageType.BOT_AGENT, "It shipped yesterday, here is the tracking link."),
        msg(MessageType.BOT_AGENT, "Are you still there?", {
          sender: "system",
          metadata: { isInactivityWarning: true },
        }),
      ]);
      expect(facts).toMatchObject({
        hadRealRequest: true,
        aiReplied: true,
        aiLastReplyIsAnswer: true,
      });
    });

    it("flags an AI reply that ends in a question", () => {
      const facts = collectCloseFacts(conversation, [
        msg(MessageType.CUSTOMER, "I need to change my delivery address please"),
        msg(MessageType.BOT_AGENT, "Sure, what is your order number?"),
      ]);
      expect(facts).toMatchObject({ hadRealRequest: true, aiLastReplyIsAnswer: false });
    });

    it("recognises playground and replay conversations", () => {
      for (const metadata of [
        { sourceId: "playground" },
        { isPlayground: true },
        { runKind: "simulation" },
      ]) {
        expect(collectCloseFacts({ ...conversation, metadata }, []).isTest).toBe(true);
      }
    });
  });

  it("computeRelevance adds signal weights and clamps to 0-100", () => {
    expect(computeRelevance(50, { handedOff: true, actionType: "knowledge_add" })).toBe(80);
    expect(computeRelevance(95, { handedOff: true, actionType: "none" })).toBe(100);
    expect(computeRelevance(Number.NaN, { handedOff: false, actionType: "none" })).toBe(0);
  });

  describe("parseClassifierResponse", () => {
    const valid = {
      is_spam: false,
      had_real_request: true,
      ai_resolved: true,
      outcome_reason: "Answered",
      summary: "s",
      polarity: "positive",
      action_type: "none",
      severity: "low",
      confidence: 0.9,
      relevance: 10,
      root_cause: "",
      area: "shipping",
      snippet: "x",
      paraphrase: "y",
    };

    it("rejects a response without the billing booleans, so the row is retried", () => {
      expect(() =>
        parseClassifierResponse(JSON.stringify({ ...valid, ai_resolved: "yes" })),
      ).toThrow();
      expect(() => parseClassifierResponse("not json")).toThrow();
    });

    it("coerces unknown enum values to safe defaults", () => {
      const parsed = parseClassifierResponse(
        JSON.stringify({ ...valid, action_type: "rewrite_everything", confidence: 7 }),
      );
      expect(parsed.action_type).toBe("none");
      expect(parsed.confidence).toBe(1);
    });
  });

  it("buildTranscript keeps customer, AI and human lines only", () => {
    const transcript = buildTranscript([
      msg(MessageType.CUSTOMER, "Hi, my parcel is late"),
      msg(MessageType.TOOL, '{"order":1}'),
      msg(MessageType.BOT_AGENT, "Let me check."),
      msg(MessageType.HUMAN_AGENT, "I found it."),
    ]);
    expect(transcript).toBe(
      "Customer: Hi, my parcel is late\nAI: Let me check.\nHuman agent: I found it.",
    );
  });
});

describe("isTestConversation", () => {
  it("treats replay and simulation runs as tests", () => {
    expect(isTestConversation({ runKind: "simulation" })).toBe(true);
    expect(isTestConversation({ runKind: "replay" })).toBe(true);
  });

  it("does not treat a channel's metadata object under runKind as a test", () => {
    expect(isTestConversation({ runKind: { conversationId: "x" } })).toBe(false);
  });
});
