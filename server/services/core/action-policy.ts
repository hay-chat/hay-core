/**
 * Policy gate for AI write actions (D4-4).
 *
 * Decides, per tool call, whether it runs now or waits for a person. Pure: the
 * caller supplies the tool's risk class, the args and the org's settings.
 *
 * With `moneyMovesNeedApproval` on (the default):
 *  - reads run;
 *  - refunds, cancels and discounts are held unless their amount is known and
 *    at or below `thresholdAmount` (a cancel's amount is usually unknown, so
 *    cancels are held);
 *  - a money tool that enforces its own cap (capEnforced) runs: within the cap
 *    it needs no approval, and above it the plugin refuses with NEEDS_APPROVAL,
 *    which core turns into a hold (see ToolExecutionService.runLive);
 *  - tools that do not declare a risk class are held (they may move money);
 *  - other classified writes (address change, note, return, ...) run.
 * With it off, every call runs.
 */
import type { ActionApprovalConfig } from "@server/types/organization-settings.types";
import { MONEY_CATEGORIES, type ToolRisk } from "./tool-risk";

export type GateDecision =
  | { kind: "allow" }
  | { kind: "hold"; reason: "money_move" | "unclassified_write"; amount: number | null };

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
  config: Pick<ActionApprovalConfig, "moneyMovesNeedApproval" | "thresholdAmount">,
): GateDecision {
  if (risk.readOnly || !config.moneyMovesNeedApproval) return { kind: "allow" };

  if (!risk.classified) {
    return { kind: "hold", reason: "unclassified_write", amount: extractAmount(args) };
  }

  if (MONEY_CATEGORIES.has(risk.category) && !risk.capEnforced) {
    const amount = extractAmount(args);
    if (amount === null || amount > config.thresholdAmount) {
      return { kind: "hold", reason: "money_move", amount };
    }
  }

  return { kind: "allow" };
}
