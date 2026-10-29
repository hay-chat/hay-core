import type { QuickCheckSettings } from "@server/types/organization-settings.types";

/**
 * Pure rules of the quick check with the team (D19): when the AI may ask the
 * team instead of handing off, and which timer step is due.
 */

/** A conversation asks the team at most this often; the next unknown fact is a hand-off. */
export const MAX_QUESTIONS_PER_CONVERSATION = 2;
/** Open questions an organization may start per hour before falling back to hand-offs. */
export const MAX_QUESTIONS_PER_ORG_PER_HOUR = 20;

export type QuickCheckRefusal =
  /** The organization has not turned quick checks on. */
  | "disabled"
  /** Playground, simulation or replay: no team to ask. */
  | "test"
  /** Spam-flagged conversations get nothing from the team (D9-6). */
  | "spam"
  /** Replies wait for approval (test mode / drafts only): T0 would be held, so no timers (Roger, D19 answer 8). */
  | "approval"
  /** This conversation already used its checks. */
  | "conversation_limit"
  /** The organization hit its hourly cap. */
  | "org_cap";

export interface QuickCheckFacts {
  settings: Required<QuickCheckSettings>;
  isTest: boolean;
  spamFlagged: boolean;
  repliesHeldForReview: boolean;
  /** A question of this conversation is waiting on its timers. */
  hasOpenQuestion: boolean;
  questionsInConversation: number;
  questionsInOrganizationLastHour: number;
}

export type QuickCheckDecision =
  | { action: "ask" }
  /** Add the new fact to the open question instead of asking again. */
  | { action: "append" }
  | { action: "refuse"; reason: QuickCheckRefusal };

export function decideQuickCheck(facts: QuickCheckFacts): QuickCheckDecision {
  if (!facts.settings.enabled) return { action: "refuse", reason: "disabled" };
  if (facts.isTest) return { action: "refuse", reason: "test" };
  if (facts.spamFlagged) return { action: "refuse", reason: "spam" };
  if (facts.repliesHeldForReview) return { action: "refuse", reason: "approval" };
  if (facts.hasOpenQuestion) return { action: "append" };
  if (facts.questionsInConversation >= MAX_QUESTIONS_PER_CONVERSATION) {
    return { action: "refuse", reason: "conversation_limit" };
  }
  if (facts.questionsInOrganizationLastHour >= MAX_QUESTIONS_PER_ORG_PER_HOUR) {
    return { action: "refuse", reason: "org_cap" };
  }
  return { action: "ask" };
}

/** The open question's next timer step: the wait ends, the shopper gets an update, or nothing yet. */
export function dueTimerStep(
  question: { askedAt: Date; updateSentAt: Date | null },
  settings: Pick<Required<QuickCheckSettings>, "updateAfterMinutes" | "giveUpAfterMinutes">,
  now: Date,
): "give_up" | "update" | null {
  const elapsedMs = now.getTime() - question.askedAt.getTime();
  if (elapsedMs >= settings.giveUpAfterMinutes * 60_000) return "give_up";
  if (!question.updateSentAt && elapsedMs >= settings.updateAfterMinutes * 60_000) return "update";
  return null;
}

/** Minutes the shopper still waits after the "still checking" update. */
export function minutesLeftAfterUpdate(
  settings: Pick<Required<QuickCheckSettings>, "updateAfterMinutes" | "giveUpAfterMinutes">,
): number {
  return Math.max(1, settings.giveUpAfterMinutes - settings.updateAfterMinutes);
}

/** Which T+10 line fits the channel and what we know about the shopper. */
export function gaveUpVariant(
  channel: string,
  contactEmail: string | null,
): "chat" | "email" | "leave_email" {
  if (channel !== "web") return "chat";
  return contactEmail ? "email" : "leave_email";
}
