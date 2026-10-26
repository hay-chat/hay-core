/**
 * Refund tool — Magento refunds are credit memos:
 *
 *   POST /invoice/{invoiceId}/refund   online  (money goes back through the gateway)
 *   POST /order/{orderId}/refund       offline (records the refund only)
 *
 * One semantic action over three endpoints: read the order, find its
 * invoice, create the credit memo. Bounded server-side: never more than paid
 * minus already refunded, only paid orders, and never a silent offline
 * refund — `online=false` must be passed explicitly to record a refund made
 * outside Magento.
 */

const { z } = require("zod");
const { magentoApi } = require("../lib/client");
const { ok, fail, num, round2 } = require("../lib/format");
const { resolveOrder, getInvoices } = require("../lib/orders");

/** Build credit-memo items for the requested line items (parent rows only). */
function buildItems(order, requested) {
  return requested.map((req) => {
    const li = (order.items || []).find((i) => String(i.item_id) === String(req.item_id));
    if (!li) {
      throw new Error(
        `Item ${req.item_id} is not on order #${order.increment_id}. Valid item ids: ` +
          (order.items || [])
            .filter((i) => !i.parent_item_id)
            .map((i) => `${i.item_id} (${i.name})`)
            .join(", "),
      );
    }
    const refundable = num(li.qty_invoiced || li.qty_ordered) - num(li.qty_refunded);
    if (req.quantity < 1 || req.quantity > refundable) {
      throw new Error(
        `Quantity ${req.quantity} for "${li.name}" must be between 1 and ${refundable}.`,
      );
    }
    return { order_item_id: li.item_id, qty: req.quantity };
  });
}

function registerRefundTools(server) {
  server.tool(
    "magento_create_refund",
    "Refund an order by creating a credit memo (WRITE). Omit amount and items for a full refund " +
      "of whatever was paid and not yet refunded; pass items to refund specific lines (Magento " +
      "prices them) or amount for an arbitrary partial refund (booked as an adjustment). Refuses " +
      "unpaid orders and amounts above the remaining balance. Online by default: the money goes " +
      "back through the payment gateway via the order's invoice. If there is no invoice or the " +
      "gateway cannot refund, the error says so — refund elsewhere and re-run with online=false " +
      "to record it.",
    {
      order_id: z.string().optional().describe("Magento order entity id."),
      order_number: z
        .string()
        .optional()
        .describe("The order number the customer sees (increment id)."),
      amount: z
        .string()
        .optional()
        .describe(
          'Partial amount as a decimal string (e.g. "10.50"); booked as a positive adjustment.',
        ),
      items: z
        .array(
          z.object({
            item_id: z.string().describe("Order item id from magento_get_order."),
            quantity: z.number().int().describe("Quantity of that item to refund."),
          }),
        )
        .optional()
        .describe("Specific items to refund."),
      refund_shipping: z
        .boolean()
        .optional()
        .describe("Also refund the shipping amount (default false)."),
      reason: z
        .string()
        .optional()
        .describe("Why the refund is issued (added as a credit memo comment)."),
      restock: z.boolean().optional().describe("Return refunded items to stock (default false)."),
      notify_customer: z
        .boolean()
        .optional()
        .describe("Email the customer the credit memo (default false)."),
      online: z
        .boolean()
        .optional()
        .describe(
          "Refund through the payment gateway (default true). false only records a refund made elsewhere.",
        ),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const ref = `#${order.increment_id}`;
        const paid = num(order.total_paid);
        const refunded = num(order.total_refunded);
        const remaining = round2(Math.max(0, paid - refunded));
        if (order.state === "canceled")
          throw new Error(`Order ${ref} is cancelled; nothing to refund.`);
        if (paid <= 0) {
          throw new Error(
            `Order ${ref} has no recorded payment (state "${order.state}"); there is nothing to refund.`,
          );
        }
        if (remaining <= 0) {
          throw new Error(
            `Order ${ref} is already fully refunded (${order.total_paid} ${order.order_currency_code}).`,
          );
        }

        let amount = null;
        if (args.amount !== undefined) {
          amount = Number(args.amount);
          if (!Number.isFinite(amount) || amount <= 0)
            throw new Error(`Invalid refund amount "${args.amount}".`);
          if (amount > remaining + 0.001) {
            throw new Error(
              `Refund of ${amount.toFixed(2)} exceeds the remaining refundable balance of ` +
                `${remaining.toFixed(2)} ${order.order_currency_code} for order ${ref}.`,
            );
          }
        }

        const online = args.online ?? true;
        const body = {
          items: args.items?.length ? buildItems(order, args.items) : [],
          notify: Boolean(args.notify_customer),
          appendComment: Boolean(args.reason),
          arguments: {
            shipping_amount: args.refund_shipping ? num(order.shipping_amount) : 0,
            adjustment_positive: 0,
            adjustment_negative: 0,
            extension_attributes: { return_to_stock_items: [] },
          },
        };
        if (args.reason) {
          body.comment = { comment: args.reason, is_visible_on_front: 0 };
        }
        if (args.restock && body.items.length) {
          body.arguments.extension_attributes.return_to_stock_items = body.items.map(
            (i) => i.order_item_id,
          );
        }

        if (amount !== null) {
          // Arbitrary partial refund: no item lines, the amount is a positive adjustment.
          body.items = (order.items || [])
            .filter((i) => !i.parent_item_id)
            .map((i) => ({ order_item_id: i.item_id, qty: 0 }));
          body.arguments.shipping_amount = 0;
          body.arguments.adjustment_positive = round2(amount);
        }

        let path;
        if (online) {
          const invoices = await getInvoices(order.entity_id);
          const invoice = invoices.find((inv) => num(inv.state) === 2) || invoices[0]; // 2 = paid
          if (!invoice) {
            throw new Error(
              `Order ${ref} has no invoice, so Magento cannot refund it online. If the customer was ` +
                "charged outside Magento, refund them there and re-run magento_create_refund with " +
                "online=false to record it.",
            );
          }
          body.isOnline = true;
          path = `/invoice/${invoice.entity_id}/refund`;
        } else {
          body.isOnline = false;
          path = `/order/${order.entity_id}/refund`;
        }

        let creditMemoId;
        try {
          creditMemoId = await magentoApi("POST", path, { body });
        } catch (err) {
          if (online) {
            throw new Error(
              `${err.message}. If the payment method (${order.payment?.method || "unknown"}) cannot refund ` +
                "through Magento, refund the customer in the gateway's dashboard and re-run " +
                "magento_create_refund with online=false to record it on the order.",
            );
          }
          throw err;
        }

        const after = await resolveOrder({ order_id: String(order.entity_id) }).catch(() => null);
        const refundedNow = after
          ? round2(num(after.total_refunded) - refunded)
          : (amount ?? remaining);
        return ok({
          refunded: true,
          online,
          id: order.entity_id,
          number: order.increment_id,
          creditMemoId: creditMemoId ?? null,
          amount: { amount: refundedNow.toFixed(2), currency: order.order_currency_code },
          remainingRefundable: {
            amount: round2(Math.max(0, remaining - refundedNow)).toFixed(2),
            currency: order.order_currency_code,
          },
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerRefundTools, buildItems };
