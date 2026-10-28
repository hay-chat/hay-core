/**
 * Policy gate for AI write actions (D4-4, D4-9).
 *
 * Decides, per tool call, whether it runs now or waits for a person. Pure: the
 * caller supplies the tool's risk class, the args, the org's settings and the
 * active playbook's approval list. The strictest rule wins:
 *  - reads run;
 *  - a category the active playbook lists always waits (a playbook can only
 *    tighten, so this applies even when the org's approval is off);
 *  - with the org's approval off (`moneyMovesNeedApproval` false), every other
 *    call runs;
 *  - tools that do not declare a risk class are held (they may move money);
 *  - a category the org does not require approval for runs (by default only
 *    money moves - refund, cancel, discount, exchange - require it);
 *  - a tool that enforces its own cap (capEnforced) runs: within the cap it
 *    needs no approval, and above it the plugin refuses with NEEDS_APPROVAL,
 *    which core turns into a hold (see ToolExecutionService.runLive);
 *  - refunds and discounts whose amount is known and at or below
 *    `thresholdAmount` run; everything else in a required category is held.
 */
import type {
  ActionApprovalConfig,
  ApprovalCategory,
} from "@server/types/organization-settings.types";
import { MONEY_CATEGORIES, type ToolRisk, type WriteCategory } from "./tool-risk";

export type GateDecision =
  | { kind: "allow" }
  | {
      kind: "hold";
      reason: "money_move" | "category_policy" | "playbook_policy" | "unclassified_write";
      amount: number | null;
    };

/** Categories the auto-approve amount applies to. */
export const THRESHOLD_CATEGORIES: ReadonlySet<WriteCategory> = new Set(["refund", "discount"]);

/** Does the org require approval for this category? Missing = money moves only. */
export function categoryNeedsApproval(
  config: Partial<Pick<ActionApprovalConfig, "categories">>,
  category: WriteCategory,
): boolean {
  const configured = config.categories?.[category as ApprovalCategory];
  return typeof configured === "boolean" ? configured : MONEY_CATEGORIES.has(category);
}

/** Tool-error code a cap-enforcing plugin returns for a call above its cap. */
export const NEEDS_APPROVAL_CODE = "NEEDS_APPROVAL";

function toAmount(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The money amount in a tool call's args, when the call states one: the sum of
 * `transactions[].amount` (Shopify-style refunds), else `amount`. Null when
 * the args do not say (e.g. "refund the whole order", or a cancel).
 */
export function extractAmount(args: Record<string, unknown>): number | null {
  if (Array.isArray(args.transactions) && args.transactions.length > 0) {
    let total = 0;
    for (const transaction of args.transactions) {
      const amount = toAmount((transaction as { amount?: unknown } | null)?.amount);
      if (amount === null) return null;
      total += amount;
    }
    return total;
  }
  return toAmount(args.amount);
}

export function decideGate(
  risk: ToolRisk,
  args: Record<string, unknown>,
  config: Pick<ActionApprovalConfig, "moneyMovesNeedApproval" | "thresholdAmount"> &
    Partial<Pick<ActionApprovalConfig, "categories">>,
  playbookCategories: readonly string[] = [],
): GateDecision {
  if (risk.readOnly) return { kind: "allow" };

  if (playbookCategories.includes(risk.category)) {
    return { kind: "hold", reason: "playbook_policy", amount: extractAmount(args) };
  }

  if (!config.moneyMovesNeedApproval) return { kind: "allow" };

  if (!risk.classified) {
    return { kind: "hold", reason: "unclassified_write", amount: extractAmount(args) };
  }

  if (!categoryNeedsApproval(config, risk.category) || risk.capEnforced) {
    return { kind: "allow" };
  }

  const amount = extractAmount(args);
  if (THRESHOLD_CATEGORIES.has(risk.category) && amount !== null) {
    if (amount <= config.thresholdAmount) return { kind: "allow" };
  }
  const reason = MONEY_CATEGORIES.has(risk.category) ? "money_move" : "category_policy";
  return { kind: "hold", reason, amount };
}

/**
 * Would this settings change let more actions run without a person (D4-9)?
 * Turning the master switch, a category or the shopper confirmation off,
 * raising the auto-approve amount, or changing who approves all count.
 */
export function loosensActionApproval(
  current: ActionApprovalConfig,
  change: Partial<ActionApprovalConfig>,
): boolean {
  if (change.moneyMovesNeedApproval === false && current.moneyMovesNeedApproval) return true;
  if (change.customerConfirmation === false && current.customerConfirmation) return true;
  if (change.thresholdAmount !== undefined && change.thresholdAmount > current.thresholdAmount) {
    return true;
  }
  if (change.approverRoles !== undefined) return true;
  for (const [category, needsApproval] of Object.entries(change.categories ?? {})) {
    if (needsApproval === false && categoryNeedsApproval(current, category as WriteCategory)) {
      return true;
    }
  }
  return false;
}

/**
 * The literal an API caller must send as `actionApproval.confirmSwitchOff` when
 * the change switches approval off for a money move (D4-9 typed confirm). The
 * dashboard sends it only after the person typed the confirm word in their
 * language, so a plain API call cannot switch money approval off by accident.
 */
export const SWITCH_OFF_CONFIRMATION = "SWITCH OFF APPROVAL";

/**
 * Money categories that need approval now and would not after `change`, either
 * because the master switch goes off or the category does. Matches the list
 * the Settings > Actions typed confirm shows.
 */
export function moneyApprovalSwitchedOff(
  current: ActionApprovalConfig,
  change: Partial<ActionApprovalConfig>,
): WriteCategory[] {
  const after: ActionApprovalConfig = {
    ...current,
    ...change,
    categories: { ...current.categories, ...(change.categories ?? {}) },
  };
  const held = (config: ActionApprovalConfig, category: WriteCategory) =>
    config.moneyMovesNeedApproval && categoryNeedsApproval(config, category);
  return [...MONEY_CATEGORIES].filter((c) => held(current, c) && !held(after, c));
}

/** A currency code the call states, if any (`currency` or `transactions[0].currency`). */
export function extractCurrency(args: Record<string, unknown>): string | null {
  const first = Array.isArray(args.transactions)
    ? (args.transactions[0] as Record<string, unknown> | undefined)
    : undefined;
  const value = args.currency ?? first?.currency;
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null;
}

/**
 * Where an approver may lower the amount (D4-6): a top-level `amount`, or a
 * single `transactions[0].amount`. The lowered amount keeps the call's own
 * unit, so no currency is needed. Split refunds (several transactions) and
 * calls without an amount are approved as they are.
 */
export function amountEditable(args: Record<string, unknown>): boolean {
  if (Array.isArray(args.transactions)) {
    return (
      args.transactions.length === 1 &&
      toAmount((args.transactions[0] as { amount?: unknown } | null)?.amount) !== null
    );
  }
  return toAmount(args.amount) !== null;
}

/**
 * The args with the amount lowered to `next`, or null when that is not
 * allowed: only down (never up), above zero, and only where
 * `amountEditable`. Keeps the value's type (string decimals stay strings).
 */
export function lowerAmount(
  args: Record<string, unknown>,
  next: number,
): Record<string, unknown> | null {
  if (!amountEditable(args) || !Number.isFinite(next)) return null;
  const current = extractAmount(args);
  const rounded = Math.round(next * 100) / 100;
  if (current === null || rounded <= 0 || rounded > current) return null;
  const write = (previous: unknown) =>
    typeof previous === "string" ? rounded.toFixed(2) : rounded;
  if (Array.isArray(args.transactions)) {
    const [transaction] = args.transactions as Array<Record<string, unknown>>;
    return { ...args, transactions: [{ ...transaction, amount: write(transaction.amount) }] };
  }
  return { ...args, amount: write(args.amount) };
}
