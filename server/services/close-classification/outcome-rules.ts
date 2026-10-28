/**
 * Close-time outcome rules (D1-3), kept pure so the billing definition can be
 * read and tested in one place.
 *
 * Every close (resolved, unresolved or closed) gets one ConversationOutcome
 * row. The row is written at close with a deterministic rule outcome, then the
 * close classifier refines it with one LLM call. If the LLM keeps failing, the
 * rule outcome stays (see `assessByRule`).
 *
 * Billing rule (Roger, 27 Oct 2026):
 * - confirmed: the AI resolved it and the shopper said so. Billable.
 * - assumed: the AI resolved it and the shopper went quiet. Billable, reversed
 *   if the shopper comes back within REVERSAL_WINDOW_MS.
 * - Hand-offs bill when the AI resolved it, even if a human was involved.
 * - An action the AI requested for approval (D4-4) bills: the AI did the work
 *   when it requested it, whatever the team decides later.
 * - Never billable: abandoned (no real request or no real answer), unhappy
 *   (shopper closed unhappy), human (a human did the resolving), test
 *   (playground / test mode / replays), spam.
 */
import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageIntent, MessageType, type Message } from "@server/database/entities/message.entity";

export const CONVERSATION_OUTCOMES = [
  "confirmed",
  "assumed",
  "abandoned",
  "unhappy",
  "human",
  "test",
  "spam",
] as const;
export type ConversationOutcomeKind = (typeof CONVERSATION_OUTCOMES)[number];

export const BILLABLE_OUTCOMES: ReadonlyArray<ConversationOutcomeKind> = ["confirmed", "assumed"];

/** A shopper who comes back within this window reverses the charge. */
export const REVERSAL_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Statuses that end a conversation. Entering one of them records a close. */
export const CLOSED_STATUSES: ReadonlyArray<Conversation["status"]> = [
  "resolved",
  "unresolved",
  "closed",
];

/** Closed action list for insight issues (D3 §0.2, approved by Roger). */
export const INSIGHT_ACTION_TYPES = [
  "playbook_edit",
  "new_playbook",
  "knowledge_edit",
  "knowledge_add",
  "setup",
  "policy_ambiguity",
  "product_bug",
  "ux_confusion",
  "support_training",
  "none",
] as const;
export type InsightActionType = (typeof INSIGHT_ACTION_TYPES)[number];

/** Where an insight issue came from: the close classifier, or a staff rating of a reply. */
export const INSIGHT_SOURCES = ["ai_review", "user_feedback"] as const;
export type InsightSource = (typeof INSIGHT_SOURCES)[number];

export const INSIGHT_POLARITIES = ["positive", "negative", "neutral"] as const;
export type InsightPolarity = (typeof INSIGHT_POLARITIES)[number];

export const INSIGHT_SEVERITIES = ["low", "medium", "high"] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

const USER_SATISFIED_REASONS = ["user_indicated_close_satisfied", "user_indicated_greet"];
const USER_UNHAPPY_REASON = "user_indicated_close_unsatisfied";

/** Dashboard playground, the public demo playground and D7 replay/simulation runs. */
export function isTestConversation(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;
  return (
    metadata.sourceId === "playground" ||
    metadata.isPlayground === true ||
    metadata.isPlayground === "true" ||
    (metadata.runKind !== undefined && metadata.runKind !== null)
  );
}

/** The parts of a closed conversation the rules look at. */
export interface CloseFacts {
  closeReason: string | null;
  isTest: boolean;
  spamFlagged: boolean;
  handedOff: boolean;
  /** At least one customer message that asks for something (not just "hi"/"thanks"). */
  hadRealRequest: boolean;
  /** At least one AI reply after the first real request. */
  aiReplied: boolean;
  /** The AI's last reply is a real answer, not a question back to the shopper. */
  aiLastReplyIsAnswer: boolean;
  /** The AI requested an action that needed a person's approval (D4-4). */
  approvalRequested: boolean;
}

/** What the LLM decides. Absent when the rule outcome is final or the LLM failed. */
export interface ClassifierVerdict {
  isSpam: boolean;
  hadRealRequest: boolean;
  aiResolved: boolean;
}

export interface OutcomeDecision {
  outcome: ConversationOutcomeKind;
  billable: boolean;
  aiResolved: boolean;
}

/** AI messages that are system chatter, not answers. */
function isSystemBotMessage(message: Message): boolean {
  const metadata = message.metadata ?? {};
  return (
    message.sender === "system" ||
    metadata.isInactivityWarning === true ||
    metadata.isClosureMessage === true ||
    metadata.isHandoffMessage === true ||
    metadata.reason === "inactivity_timeout"
  );
}

const NON_REQUEST_INTENTS: ReadonlyArray<string> = [
  MessageIntent.GREET,
  MessageIntent.CLOSE_SATISFIED,
  MessageIntent.CLOSE_UNSATISFIED,
];

/** A customer message that asks for something. Unperceived messages count when they are not tiny. */
function isRealRequest(message: Message): boolean {
  if (message.intent) return !NON_REQUEST_INTENTS.includes(message.intent);
  return message.content.trim().length > 20;
}

/** Collect the facts the rules need from the conversation and its messages. */
export function collectCloseFacts(
  conversation: Pick<
    Conversation,
    "resolution_metadata" | "metadata" | "handed_off_at" | "spam_flagged_at"
  >,
  messages: Message[],
): CloseFacts {
  const ordered = [...messages].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  const firstRequestIndex = ordered.findIndex(
    (m) => m.type === MessageType.CUSTOMER && isRealRequest(m),
  );
  const aiReplies =
    firstRequestIndex === -1
      ? []
      : ordered
          .slice(firstRequestIndex + 1)
          .filter((m) => m.type === MessageType.BOT_AGENT && !isSystemBotMessage(m));
  const lastReply = aiReplies[aiReplies.length - 1];

  return {
    closeReason: conversation.resolution_metadata?.reason ?? null,
    isTest: isTestConversation(conversation.metadata),
    spamFlagged:
      conversation.spam_flagged_at !== null && conversation.spam_flagged_at !== undefined,
    handedOff: conversation.handed_off_at !== null && conversation.handed_off_at !== undefined,
    hadRealRequest: firstRequestIndex !== -1,
    aiReplied: aiReplies.length > 0,
    aiLastReplyIsAnswer: !!lastReply && !lastReply.content.trim().endsWith("?"),
    approvalRequested: ordered.some(
      (m) => m.type === MessageType.TOOL && typeof m.metadata?.pendingActionId === "string",
    ),
  };
}

/** True when the rule outcome is final and the LLM call would add nothing. */
export function needsClassifier(facts: CloseFacts): boolean {
  return !facts.isTest && !facts.spamFlagged && facts.hadRealRequest;
}

/**
 * The deterministic fallback, used at close and whenever the LLM fails.
 * It errs towards not billing: it never bills a handed-off conversation
 * (only the LLM can tell whether the AI resolved it before the hand-off),
 * and a silent close bills only when the AI's last reply was an answer.
 */
export function assessByRule(facts: CloseFacts): ClassifierVerdict {
  const answered = shopperConfirmed(facts)
    ? facts.aiReplied
    : facts.aiReplied && facts.aiLastReplyIsAnswer;
  return {
    isSpam: false,
    hadRealRequest: facts.hadRealRequest,
    aiResolved: facts.hadRealRequest && answered && !facts.handedOff,
  };
}

/** Map facts plus a verdict (LLM or rule) to the stored outcome. Order matters. */
export function decideOutcome(facts: CloseFacts, verdict: ClassifierVerdict): OutcomeDecision {
  const decide = (outcome: ConversationOutcomeKind, aiResolved = false): OutcomeDecision => ({
    outcome,
    billable: BILLABLE_OUTCOMES.includes(outcome),
    aiResolved,
  });

  if (facts.isTest) return decide("test");
  if (facts.spamFlagged || verdict.isSpam) return decide("spam");
  // The shopper's own "this didn't help" beats any model opinion.
  if (facts.closeReason === USER_UNHAPPY_REASON) return decide("unhappy");
  if (facts.approvalRequested)
    return decide(shopperConfirmed(facts) ? "confirmed" : "assumed", true);
  if (!facts.hadRealRequest || !verdict.hadRealRequest) return decide("abandoned");
  if (!verdict.aiResolved) return decide(facts.handedOff ? "human" : "abandoned");

  return decide(shopperConfirmed(facts) ? "confirmed" : "assumed", true);
}

function shopperConfirmed(facts: CloseFacts): boolean {
  return facts.closeReason ? USER_SATISFIED_REASONS.includes(facts.closeReason) : false;
}

/** Inactivity closes are the only ones the classifier may move to `unresolved`. */
export function isInactivityClose(closeReason: string | null): boolean {
  return closeReason === "inactivity_timeout" || closeReason === "inactivity_timeout_silent";
}

/**
 * Relevance of an insight issue, 0-100: the model's score plus starting
 * signal weights from D3 §0.1 (thumbs-down +30, takeover +20, knowledge gap
 * +10). Tune on real data in the Insights engine.
 */
export function computeRelevance(
  modelRelevance: number,
  signals: { handedOff: boolean; actionType: InsightActionType; negativeFeedback?: boolean },
): number {
  let score = Number.isFinite(modelRelevance) ? modelRelevance : 0;
  if (signals.negativeFeedback) score += 30;
  if (signals.handedOff) score += 20;
  if (signals.actionType === "knowledge_add" || signals.actionType === "knowledge_edit") {
    score += 10;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
