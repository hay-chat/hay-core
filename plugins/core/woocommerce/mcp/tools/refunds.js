/**
 * Refund tool — POST /orders/{id}/refunds, bounded server-side:
 *   - never more than total minus what was already refunded,
 *   - only orders that were actually paid,
 *   - amount computed from the order's own line-item totals when refunding items,
 *   - never silently "record only": refund_payment=true (default) asks the
 *     payment gateway for the money; when the gateway cannot, WooCommerce's
 *     error is surfaced with the explicit manual-refund fallback.
 */

const { z } = require("zod");
const { wcApi } = require("../lib/client");
const { ok, fail, num, round2 } = require("../lib/format");
const { resolveOrder, refundedTotal } = require("../lib/orders");

/** Build WooCommerce refund line items + their amount from the order's own totals. */
function buildLineItemRefund(order, requested) {
  const lines = [];
  let amount = 0;
  for (const req of requested) {
    const li = (order.line_items || []).find((l) => String(l.id) === String(req.line_item_id));
    if (!li) {
      throw new Error(
        `Line item ${req.line_item_id} is not on order #${order.number}. Valid line item ids: ` +
          (order.line_items || []).map((l) => `${l.id} (${l.name})`).join(", "),
      );
    }
    if (req.quantity < 1 || req.quantity > li.quantity) {
      throw new Error(
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

function registerRefundTools(server) {
  server.tool(
    "woocommerce_create_refund",
    "Refund an order (WRITE). Omit amount and line_items for a full refund of whatever is left; " +
      "pass line_items to refund specific items (amount computed from the order) or amount for an " +
      "arbitrary partial refund. Refuses unpaid orders and amounts above the remaining refundable " +
      "balance. By default the payment gateway is asked to return the money; if it cannot, the " +
      "error says so — refund in the gateway and re-run with refund_payment=false to record it.",
    {
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
      reason: z.string().optional().describe("Why the refund is issued (stored on the refund)."),
      restock: z.boolean().optional().describe("Restock refunded items (default false)."),
      refund_payment: z
        .boolean()
        .optional()
        .describe(
          "Ask the payment gateway to return the money (default true). false only records a refund made elsewhere.",
        ),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const ref = `#${order.number}`;
        if (order.status === "cancelled" && !order.date_paid) {
          throw new Error(`Order ${ref} is cancelled and was never paid; nothing to refund.`);
        }
        if (!order.date_paid && order.status !== "completed") {
          throw new Error(
            `Order ${ref} has no recorded payment (status "${order.status}"); there is nothing to refund.`,
          );
        }
        const remaining = round2(Math.max(0, num(order.total) - refundedTotal(order)));
        if (remaining <= 0) {
          throw new Error(
            `Order ${ref} is already fully refunded (${order.total} ${order.currency}).`,
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
          throw new Error(`Invalid refund amount "${args.amount}".`);
        }
        if (amount > remaining + 0.001) {
          throw new Error(
            `Refund of ${amount.toFixed(2)} exceeds the remaining refundable balance of ` +
              `${remaining.toFixed(2)} ${order.currency} for order ${ref}.`,
          );
        }

        const refundPayment = args.refund_payment ?? true;
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
          if (refundPayment) {
            throw new Error(
              `${err.message}. If the payment gateway (${order.payment_method_title || order.payment_method}) ` +
                "cannot refund through WooCommerce, refund the customer in the gateway's dashboard and " +
                "re-run woocommerce_create_refund with refund_payment=false to record it on the order.",
            );
          }
          throw err;
        }

        return ok({
          refunded: true,
          gatewayRefunded: refundPayment,
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

module.exports = { registerRefundTools, buildLineItemRefund };
