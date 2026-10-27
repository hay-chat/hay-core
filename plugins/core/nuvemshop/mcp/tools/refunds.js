/**
 * Refund tools — honest by construction.
 *
 *   nuvemshop_check_refund_status  order payment fields + transactions (refund events, dates)
 *   nuvemshop_request_refund       records a capped refund request on the order (owner_note)
 *
 * The Nuvemshop merchant API has NO endpoint that returns money: refunds are
 * started by the merchant in the payment provider (the Transactions refund flow
 * is reserved to payment-provider apps, which Nuvemshop calls at
 * info.refund_url). So request_refund never claims money moved; it validates
 * the request against the order (paid, not already refunded, amount capped),
 * writes it on the order where the merchant works, and tells the agent to hand
 * off.
 */

const { z } = require("zod");
const { nsApi } = require("../lib/client");
const { ok, fail, num, round2, READ, WRITE } = require("../lib/format");
const {
  HOW_TO_REFUND,
  resolveOrder,
  getTransactions,
  transactionRefunded,
  refundState,
  PAID_STATUSES,
} = require("../lib/orders");
const { ORDER_REF, appendOwnerNote } = require("./orders");

function refundEvents(transactions) {
  const rows = [];
  for (const t of transactions || []) {
    for (const e of t.events || []) {
      if (e.type !== "refund") continue;
      rows.push({
        transactionId: t.id ?? null,
        status: e.status ?? null,
        amount: e.amount?.value ?? e.amount ?? null,
        currency: e.amount?.currency ?? null,
        happenedAt: e.happened_at ?? e.created_at ?? null,
      });
    }
  }
  return rows;
}

function registerRefundTools(server) {
  server.registerTool(
    "nuvemshop_check_refund_status",
    {
      description:
        "Inspect an order's refund situation: refund state, payment method and provider, " +
        "refund events with dates when the store exposes its transactions, and how a refund is " +
        "actually executed (always by the merchant in the payment provider). Call this before " +
        "discussing a refund.",
      inputSchema: ORDER_REF,
      annotations: READ,
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const transactions = await getTransactions(order);
        let valueHistory = null;
        try {
          valueHistory = await nsApi("GET", `/orders/${order.id}/history/values`);
        } catch {
          valueHistory = null;
        }
        const refunded = transactionRefunded(transactions);
        return ok({
          id: order.id,
          number: order.number,
          status: order.status,
          paymentStatus: order.payment_status,
          refundState: refundState(order.payment_status),
          paymentMethod: order.payment_details?.method || null,
          paymentProvider: order.gateway_name || order.gateway || null,
          total: { amount: order.total, currency: order.currency },
          refunded:
            refunded === null ? null : { amount: refunded.toFixed(2), currency: order.currency },
          refundEvents: refundEvents(transactions),
          transactionsAvailable: transactions !== null,
          valueHistory: Array.isArray(valueHistory) ? valueHistory.slice(0, 20) : null,
          refundCanBeExecutedByAgent: false,
          howToRefund: HOW_TO_REFUND,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_request_refund",
    {
      description:
        "Record a refund request on a paid order (WRITE). Nuvemshop's API cannot move money, so " +
        "this does NOT refund: it checks the order is paid and not already refunded, caps the " +
        "amount at what is left, writes the request on the order for the merchant, and returns " +
        "what to tell the customer. Always hand the conversation to a person afterwards. Omit " +
        "amount for a full refund.",
      inputSchema: {
        ...ORDER_REF,
        amount: z
          .string()
          .optional()
          .describe('Partial amount as a decimal string (e.g. "49.90"). Omit for the full amount.'),
        reason: z.string().min(3).max(500).describe("Why the customer wants the refund."),
      },
      annotations: WRITE,
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const ref = `#${order.number}`;
        if (!PAID_STATUSES.has(order.payment_status)) {
          throw new Error(
            `Order ${ref} has no captured payment (payment_status "${order.payment_status}"); ` +
              "there is nothing to refund." +
              (order.payment_status === "authorized"
                ? " The card hold is released by cancelling in the payment provider."
                : ""),
          );
        }
        if (order.payment_status === "refunded") {
          throw new Error(
            `Order ${ref} is already fully refunded (${order.total} ${order.currency}).`,
          );
        }
        const total = num(order.total);
        const transactions = await getTransactions(order);
        const refunded = transactionRefunded(transactions);
        const remaining = refunded === null ? total : round2(Math.max(0, total - refunded));
        if (remaining <= 0) {
          throw new Error(`Order ${ref} has nothing left to refund.`);
        }
        const amount =
          args.amount !== undefined ? Number(String(args.amount).replace(",", ".")) : remaining;
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error(`Invalid refund amount "${args.amount}".`);
        }
        if (amount > remaining + 0.001) {
          throw new Error(
            `Refund of ${amount.toFixed(2)} exceeds the ${refunded === null ? "order total" : "remaining balance"} ` +
              `of ${remaining.toFixed(2)} ${order.currency} for order ${ref}.`,
          );
        }
        const provider = order.gateway_name || order.gateway || "the payment provider";
        const partialUnknown = order.payment_status === "partially_refunded" && refunded === null;
        const ownerNote = await appendOwnerNote(
          order,
          `REFUND REQUESTED: ${amount.toFixed(2)} ${order.currency} via ${provider}. ` +
            `Reason: ${args.reason}. Not refunded yet — refund in the payment provider.`,
        );
        return ok({
          refundRequested: true,
          moneyMoved: false,
          id: order.id,
          number: order.number,
          amount: { amount: amount.toFixed(2), currency: order.currency },
          paymentMethod: order.payment_details?.method || null,
          paymentProvider: provider,
          ownerNote,
          warning: partialUnknown
            ? "The order was already partially refunded and the store does not expose how much; " +
              "the merchant must check the provider before refunding."
            : null,
          howToRefund: HOW_TO_REFUND,
          tellCustomer:
            "Your refund request is recorded on the order and the store team will process it " +
            "with the payment provider. Do not promise a date or say the money was returned.",
          handoff: true,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerRefundTools, refundEvents };
