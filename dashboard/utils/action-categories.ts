/**
 * Write categories of AI actions, mirrored from server/services/core/tool-risk.ts
 * and APPROVAL_CATEGORIES in server/types/organization-settings.types.ts.
 */
export const APPROVAL_CATEGORIES = [
  "refund",
  "cancel",
  "discount",
  "exchange",
  "return",
  "address_change",
  "customer_update",
  "note",
] as const;

export type ApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];

/** Money moves: need approval by default. */
export const MONEY_CATEGORIES: ReadonlySet<string> = new Set([
  "refund",
  "cancel",
  "discount",
  "exchange",
]);

/** Categories the auto-approve amount applies to (server THRESHOLD_CATEGORIES). */
export const THRESHOLD_CATEGORIES: ReadonlySet<string> = new Set(["refund", "discount"]);

/**
 * Sent with a save that switches approval off for a money move, once the person
 * typed the confirm word (server SWITCH_OFF_CONFIRMATION in core/action-policy).
 */
export const SWITCH_OFF_CONFIRMATION = "SWITCH OFF APPROVAL";
