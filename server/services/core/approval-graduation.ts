/**
 * Graduation nudge (D4-11): when a person approved every refund (or every
 * discount) the AI asked for lately, suggest auto-approving up to the largest
 * of those amounts. Only money-move holds count (not playbook or over-cap
 * holds, which the threshold does not affect), and only once there are
 * enough decisions to mean something. Never applied without the owner.
 * Amounts are only compared within one stated currency: a category whose
 * requests lack a currency or mix currencies gets no nudge.
 */
import type { PendingActionStatus } from "@server/database/entities/pending-action.entity";

export const GRADUATION_MIN_DECISIONS = 5;
export const GRADUATION_WINDOW_DAYS = 30;
/** The categories the auto-approve amount applies to (THRESHOLD_CATEGORIES). */
export const GRADUATION_CATEGORIES = ["refund", "discount"] as const;

const APPROVED: ReadonlySet<PendingActionStatus> = new Set(["approved", "executed", "failed"]);

export interface GraduationRow {
  category: string;
  status: PendingActionStatus;
  amount: number | null;
  currency: string | null;
}

export interface GraduationSuggestion {
  category: (typeof GRADUATION_CATEGORIES)[number];
  approved: number;
  total: number;
  /** The largest approved amount: the auto-approve amount to suggest. */
  amount: number;
  currency: string;
}

/**
 * The suggestion to show, or null. Per category: every decided request was
 * approved (none declined, handed to the team or left to expire), each one
 * stated an amount in the same currency, and the largest is above today's auto-approve amount.
 * When both categories qualify, the one with more approvals wins.
 */
export function suggestGraduation(
  rows: readonly GraduationRow[],
  currentThreshold: number,
): GraduationSuggestion | null {
  let best: GraduationSuggestion | null = null;
  for (const category of GRADUATION_CATEGORIES) {
    const decided = rows.filter((row) => row.category === category && row.status !== "pending");
    if (decided.length < GRADUATION_MIN_DECISIONS) continue;
    if (decided.some((row) => !APPROVED.has(row.status) || row.amount === null)) continue;
    const currencies = new Set(decided.map((row) => row.currency));
    const [currency] = currencies;
    if (currencies.size !== 1 || !currency) continue;
    const amount = Math.max(...decided.map((row) => Number(row.amount)));
    if (!(amount > currentThreshold)) continue;
    if (!best || decided.length > best.approved) {
      best = { category, approved: decided.length, total: decided.length, amount, currency };
    }
  }
  return best;
}
