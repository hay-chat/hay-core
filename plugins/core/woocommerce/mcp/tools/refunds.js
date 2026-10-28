/**
 * Refund tool — POST /orders/{id}/refunds, bounded server-side:
 *   - never more than total minus what was already refunded,
 *   - only orders that were actually paid,
 *   - amount computed from the order's own line-item totals when refunding items,
 *   - never silently "record only": refund_payment=true (default) asks the
 *     payment gateway for the money. refund_payment=false (record only) is
 *     allowed only for offline methods (bacs/cod/cheque), where the merchant
 *     pays the money back by hand, and the result says no money moved. When an
 *     online gateway refuses, the agent must hand off: re-running record-only
 *     would mark the order Refunded and email the customer while no money moved.
 */

const { z } = require("zod");
const { wcApi } = require("../lib/client");
const { ok, fail, toolError, num, round2 } = require("../lib/format");
const { resolveOrder, refundedTotal, OFFLINE_PAYMENT_METHODS } = require("../lib/orders");

/** Build WooCommerce refund line items + their amount from the order's own totals. */
function buildLineItemRefund(order, requested) {
  const lines = [];
  let amount = 0;
  for (const req of requested) {
    const li = (order.line_items || []).find((l) => String(l.id) === String(req.line_item_id));
    if (!li) {
      throw toolError(
        "BAD_INPUT",
        `Line item ${req.line_item_id} is not on order #${order.number}. Valid line item ids: ` +
          (order.line_items || []).map((l) => `${l.id} (${l.name})`).join(", "),
      );
    }
    if (req.quantity < 1 || req.quantity > li.quantity) {
      throw toolError(
        "BAD_INPUT",
        `Quantity ${req.quantity} for "${li.name}" must be between 1 and ${li.quantity}.`,
      );
    }
    const share = req.quantity / li.quantity;
    const refundTotal = round2(num(li.total) * share);
    const refundTax = (li.taxes || []).map((t) => ({
      id: t.id,
      refund_total: round2(num(t.total) * share),
    }));
    amount = round2(amount + refundTotal + refundTax.reduce((s, t) => s + t.refund_total, 0));
    lines.push({
      id: li.id,
      quantity: req.quantity,
      refund_total: refundTotal,
      refund_tax: refundTax,
    });
  }
  return { lines, amount };
}

/**
 * Validate a refund request against the order and work out what it would do:
 * refuses unpaid and fully refunded orders and amounts above what is left.
 * Shared by woocommerce_create_refund and the read-only woocommerce_calculate_refund.
 */
function planRefund(order, args) {
  const ref = `#${order.number}`;
  if (order.status === "cancelled" && !order.date_paid) {
    throw toolError(
      "PRECONDITION",
      `Order ${ref} is cancelled and was never paid; nothing to refund.`,
      {
        details: { reason: "NOT_PAID" },
      },
    );
  }
  if (!order.date_paid && order.status !== "completed") {
    throw toolError(
      "PRECONDITION",
      `Order ${ref} has no recorded payment (status "${order.status}"); there is nothing to refund.`,
      { details: { reason: "NOT_PAID", status: order.status } },
    );
  }
  const remaining = round2(Math.max(0, num(order.total) - refundedTotal(order)));
  if (remaining <= 0) {
    throw toolError(
      "PRECONDITION",
      `Order ${ref} is already fully refunded (${order.total} ${order.currency}).`,
      { details: { reason: "FULLY_REFUNDED" } },
    );
  }

  let amount = remaining;
  let lines = [];
  if (args.line_items && args.line_items.length) {
    const built = buildLineItemRefund(order, args.line_items);
    lines = built.lines;
    amount = args.amount !== undefined ? Number(args.amount) : built.amount;
  } else if (args.amount !== undefined) {
    amount = Number(args.amount);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw toolError("BAD_INPUT", `Invalid refund amount "${args.amount}".`);
  }
  if (amount > remaining + 0.001) {
    throw toolError(
      "PRECONDITION",
      `Refund of ${amount.toFixed(2)} exceeds the remaining refundable balance of ` +
        `${remaining.toFixed(2)} ${order.currency} for order ${ref}.`,
      { details: { reason: "EXCEEDS_REFUNDABLE", requested: amount, remaining } },
    );
  }
  return { ref, amount, lines, remaining };
}

/** Which order and how much: shared by the refund tool and its read-only preview. */
const REFUND_INPUT = {
  order_id: z.string().optional().describe("WooCommerce order id."),
  order_number: z.string().optional().describe("The order number the customer sees."),
  amount: z
    .string()
    .optional()
    .describe(
      'Partial amount as a decimal string (e.g. "10.50"). Omit with line_items to refund those items.',
    ),
  line_items: z
    .array(
      z.object({
        line_item_id: z.string().describe("Line item id from woocommerce_get_order."),
        quantity: z.number().int().describe("Quantity of that item to refund."),
      }),
    )
    .optional()
    .describe("Items to refund (and restock when restock=true)."),
};

function registerRefundTools(server) {
  server.tool(
    "woocommerce_calculate_refund",
    "Preview a refund without making it (read-only): the amount woocommerce_create_refund would " +
      "refund for these arguments, per-item amounts (incl. tax) and what is left refundable " +
      "afterwards. Same rules and refusals as the real refund. Omit amount and line_items to see " +
      "the full remaining balance.",
    REFUND_INPUT,
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const { amount, lines, remaining } = planRefund(order, args);
        return ok({
          id: order.id,
          number: order.number,
          amount: { amount: amount.toFixed(2), currency: order.currency },
          remainingRefundableBefore: { amount: remaining.toFixed(2), currency: order.currency },
          remainingRefundableAfter: {
            amount: round2(remaining - amount).toFixed(2),
            currency: order.currency,
          },
          lineItems: lines.map((l) => ({
            id: l.id,
            quantity: l.quantity,
            refundTotal: l.refund_total,
            refundTax: round2(l.refund_tax.reduce((sum, t) => sum + t.refund_total, 0)),
          })),
          paymentMethod: order.payment_method_title || order.payment_method || null,
          note: "Nothing was refunded. Call woocommerce_create_refund with the same arguments to refund.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_create_refund",
    "Refund an order (WRITE). Omit amount and line_items for a full refund of whatever is left; " +
      "pass line_items to refund specific items (amount computed from the order) or amount for an " +
      "arbitrary partial refund. Refuses unpaid orders and amounts above the remaining refundable " +
      "balance. By default the payment gateway is asked to return the money. Offline methods " +
      "(bank transfer/bacs, cash on delivery/cod, cheque — supportSummary.gatewayCanRefund=false " +
      "in woocommerce_get_order) cannot return money: for those, tell the customer the store " +
      "will pay the refund back by hand and pass refund_payment=false, which only records it " +
      "(moneyMoved=false). If a card/online gateway refuses, do NOT re-run: hand off to a " +
      "person, who refunds in the gateway.",
    {
      ...REFUND_INPUT,
      currency: z
        .string()
        .regex(/^[A-Za-z]{3}$/)
        .describe(
          'The order\'s currency code (ISO 4217, e.g. "USD"), as woocommerce_get_order shows it. The person ' +
            "approving the refund sees the amount in it; a different currency is refused.",
        ),
      reason: z.string().optional().describe("Why the refund is issued (stored on the refund)."),
      restock: z.boolean().optional().describe("Restock refunded items (default false)."),
      refund_payment: z
        .boolean()
        .optional()
        .describe(
          "Ask the payment gateway to return the money (default true). Use false only for " +
            "offline methods (bacs, cod, cheque): it records the refund and the store pays it back by hand.",
        ),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        if (args.currency.toUpperCase() !== String(order.currency).toUpperCase()) {
          throw toolError(
            "BAD_INPUT",
            `Order #${order.number} is in ${order.currency}, not ${args.currency}. ` +
              `Pass currency "${order.currency}".`,
            { details: { reason: "CURRENCY_MISMATCH", currency: order.currency } },
          );
        }
        const { amount, lines, remaining } = planRefund(order, args);

        const refundPayment = args.refund_payment ?? true;
        const offline = OFFLINE_PAYMENT_METHODS.has(order.payment_method);
        if (!refundPayment && !offline) {
          throw toolError(
            "PRECONDITION",
            `Order ${order.number} was paid with ${order.payment_method_title || order.payment_method}, ` +
              "which refunds through the gateway. Recording a refund without moving money is only " +
              "for offline methods (bank transfer, cash on delivery, cheque). Do not retry: hand " +
              "off to a person.",
            { details: { reason: "RECORD_ONLY_NOT_ALLOWED" } },
          );
        }
        const body = {
          amount: amount.toFixed(2),
          reason: args.reason || "",
          api_refund: refundPayment,
          api_restock: Boolean(args.restock),
        };
        if (lines.length) body.line_items = lines;

        let refund;
        try {
          refund = await wcApi("POST", `/orders/${order.id}/refunds`, { body });
        } catch (err) {
          // Only a definite refusal gets the manual-refund hint. After a timeout or an
          // unknown outcome the refund may exist; re-running would record it twice.
          if (refundPayment && err.code === "PROVIDER_REFUSED") {
            throw toolError(
              "PROVIDER_REFUSED",
              `${err.message}. The payment gateway (${order.payment_method_title || order.payment_method}) ` +
                "did not refund, so no money moved. Do NOT re-run this tool and do not tell the " +
                "customer the refund was made: hand off to a person, who refunds in the gateway.",
              { details: { ...err.details, handoff: true } },
            );
          }
          throw err;
        }

        return ok({
          refunded: true,
          gatewayRefunded: refundPayment,
          moneyMoved: refundPayment,
          recordedOnly: !refundPayment,
          ...(refundPayment
            ? {}
            : {
                note:
                  "Recorded on the order only; no money was sent. The store will pay the " +
                  "customer back by hand. Do not say the money was sent.",
              }),
          id: order.id,
          number: order.number,
          refundId: refund?.id ?? null,
          amount: { amount: amount.toFixed(2), currency: order.currency },
          remainingRefundable: {
            amount: round2(remaining - amount).toFixed(2),
            currency: order.currency,
          },
          lineItems: lines.map((l) => ({
            id: l.id,
            quantity: l.quantity,
            refundTotal: l.refund_total,
          })),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerRefundTools, buildLineItemRefund, planRefund };
