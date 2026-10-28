/**
 * Customer confirmation (D4-10): before a write action runs, the AI asks the
 * shopper "shall I do it?" and the call only goes through after the shopper
 * has answered. Generic: it keys off the tool's risk category, never a plugin.
 *
 * Mechanism. The first call is not run: its TOOL message is marked
 * NEEDS_CONFIRMATION and the AI is told to ask. The next call to the same tool
 * passes only if a customer message arrived after that ask, and its args match
 * the ones asked about (an amount may go down, never up). Each ask is used
 * once. Whether the reply was a "yes" is the AI's judgement, per the prompt.
 */
import type { ActionApprovalConfig } from "@server/types/organization-settings.types";
import type { ToolRisk } from "./tool-risk";
import { extractAmount } from "./action-policy";

export const NEEDS_CONFIRMATION_STATUS = "NEEDS_CONFIRMATION";
export const NEEDS_CONFIRMATION_RESULT_STATUS = "needs_customer_confirmation";

/** Amount-carrying keys an approver or the shopper may lower between ask and call. */
const AMOUNT_KEYS = new Set(["amount", "transactions"]);

/** Cancels always ask, even when the org switched confirmation off. */
export function needsCustomerConfirmation(
  risk: ToolRisk,
  config: Pick<ActionApprovalConfig, "customerConfirmation">,
): boolean {
  if (risk.readOnly) return false;
  if (risk.category === "cancel") return true;
  return config.customerConfirmation;
}

/** The slice of a message this check reads. */
export interface ConfirmationMessage {
  id: string;
  type: string;
  metadata?: Record<string, unknown> | null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutAmount(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => !AMOUNT_KEYS.has(key)));
}

/** Same request as the one the shopper was asked about; the amount may only go down. */
export function sameRequest(asked: Record<string, unknown>, now: Record<string, unknown>): boolean {
  if (stableStringify(asked) === stableStringify(now)) return true;
  const askedAmount = extractAmount(asked);
  const nowAmount = extractAmount(now);
  if (askedAmount === null || nowAmount === null || nowAmount > askedAmount) return false;
  return stableStringify(withoutAmount(asked)) === stableStringify(withoutAmount(now));
}

/** Messages that speak to the shopper; they split the shopper's replies into turns. */
const REPLY_TYPES = new Set(["BotAgent", "HumanAgent"]);

/**
 * The ask this call may use, or null. `messages` is newest first. Only the
 * most recent unused ask for this tool counts, and only when this call comes
 * in the turn that answers it: the shopper wrote after the ask, and nobody
 * replied to the shopper since (a "no" followed by more chat is not a yes).
 */
export function findConfirmation(
  messages: readonly ConfirmationMessage[],
  toolName: string,
  args: Record<string, unknown>,
  currentMessageId?: string,
): ConfirmationMessage | null {
  let customerReplied = false;
  let repliedToCustomer = false;
  for (const message of messages) {
    if (message.id === currentMessageId) continue;
    if (message.type === "Customer") {
      if (repliedToCustomer) return null;
      customerReplied = true;
      continue;
    }
    if (REPLY_TYPES.has(message.type)) {
      // Newer than the shopper's reply: said in this same turn, fine.
      if (customerReplied) repliedToCustomer = true;
      continue;
    }
    const metadata = message.metadata ?? {};
    if (
      message.type !== "Tool" ||
      metadata.toolStatus !== NEEDS_CONFIRMATION_STATUS ||
      metadata.toolName !== toolName ||
      metadata.confirmationUsed === true
    ) {
      continue;
    }
    const asked = (metadata.toolInput ?? {}) as Record<string, unknown>;
    return customerReplied && sameRequest(asked, args) ? message : null;
  }
  return null;
}

/** What the AI gets back instead of running the action. */
export function confirmationRequest(toolName: string): Record<string, unknown> {
  return {
    status: NEEDS_CONFIRMATION_RESULT_STATUS,
    tool: toolName,
    message:
      "NOT DONE. Before this action, ask the customer to confirm. Say plainly what " +
      "will be done (or requested) with the key details (order, items, amount) and " +
      "ask if they want you to go ahead. Call this tool again with the same " +
      "arguments only after the customer clearly says yes. If they say no or are " +
      "unsure, do not call it.",
  };
}
