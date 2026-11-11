/**
 * Why the AI handed a conversation to the team, as a fixed code. Stored on
 * `conversations.metadata.handoffReason` at the first hand-off and counted by
 * the hand-offs report. A code, never the planner's free text: it aggregates
 * and holds no customer data.
 */
export const HANDOFF_REASONS = [
  // Planned: the playbook's "Handoff to human" step.
  "playbook",
  // The shopper asked for a person.
  "customer_request",
  // Fallbacks: the AI could not or was not allowed to answer.
  "low_confidence",
  "company_interest",
  "action_claim",
  "broken_link",
  "unverified_date",
  "unanswered_fact",
  "ai_unavailable",
  "planning_exhausted",
  "ai_decision",
] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

/** Hand-offs with no stored reason: from before reasons were kept, or a teammate taking over. */
export const HANDOFF_REASON_NOT_RECORDED = "not_recorded";
export type ReportedHandoffReason = HandoffReason | typeof HANDOFF_REASON_NOT_RECORDED;

export type HandoffCategory = "planned" | "customer_asked" | "fallback" | "not_recorded";

export function handoffCategory(reason: ReportedHandoffReason): HandoffCategory {
  if (reason === "playbook") return "planned";
  if (reason === "customer_request") return "customer_asked";
  if (reason === HANDOFF_REASON_NOT_RECORDED) return "not_recorded";
  return "fallback";
}

export function isHandoffReason(value: unknown): value is HandoffReason {
  return typeof value === "string" && (HANDOFF_REASONS as readonly string[]).includes(value);
}

/**
 * The reason for one hand-off. A guardrail or outage explains itself and wins;
 * then the playbook's planned step (the same rule that bills it as `assisted`);
 * then the shopper asking for a person; otherwise the planner chose to.
 */
export function resolveHandoffReason(facts: {
  /** Set by the guardrail or fallback that produced the hand-off. */
  code?: HandoffReason;
  aiUnavailable?: boolean;
  planningExhausted?: boolean;
  plannedHandoff: boolean;
  customerAskedForHuman: boolean;
}): HandoffReason {
  if (facts.aiUnavailable) return "ai_unavailable";
  if (facts.planningExhausted) return "planning_exhausted";
  if (facts.code) return facts.code;
  if (facts.plannedHandoff) return "playbook";
  if (facts.customerAskedForHuman) return "customer_request";
  return "ai_decision";
}
