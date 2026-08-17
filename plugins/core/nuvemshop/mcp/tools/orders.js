// tools/orders.js — Nuvemshop order tools, including the refund workflow.
// Registrar: registerOrderTools
//
// Refund honesty — read before editing: the Nuvemshop/Tiendanube merchant API
// has NO endpoint that moves money. The Transactions refund flow is exclusive
// to approved payment-provider apps, and POST /orders/{id}/cancel only updates
// status/stock/notifications. Refund execution lives with the payment provider
// (e.g. Mercado Pago's own API, or Nuvem Pago's "Estornar pagamento" in the
// store admin). These tools therefore (a) report refund state truthfully,
// (b) cancel orders with explicit guardrails, and (c) never claim money moved.
//
// NOTE: no store-wide free-text order search on purpose — a customer-facing
// agent must only see orders belonging to the verified customer; a broad
// search is a data-exposure vector under prompt injection. Look orders up by
// id, by exact number, or by customer id.

const { z } = require("zod");
const { nuvemshopApi } = require("../lib/client");
const { ok, fail, slimOrder, orderSupportSummary } = require("../lib/format");

const HOW_TO_REFUND =
  "Money movement cannot be triggered through the Nuvemshop API. To actually refund: " +
  "the merchant refunds from the payment provider — for Nuvem Pago, admin → order → " +
  "'Estornar pagamento'; for Mercado Pago and other gateways, from that provider's " +
  "panel (or its own API). After the provider processes it, the order's payment_status " +
  "becomes 'refunded' or 'partially_refunded' here.";

/** Actionable not-found error: say what id failed and which tool to try instead. */
function orderNotFound(orderId) {
  return new Error(
    `Order ${orderId} not found. The numeric order id differs from the customer-facing ` +
      "order number — for a number like '#101' use nuvemshop_get_order_by_number, or list " +
      "the customer's orders with nuvemshop_list_customer_orders.",
  );
}

function registerOrderTools(server) {
  server.tool(
    "nuvemshop_get_order",
    "Get an order by its internal numeric ID: line items, totals, payment and shipping status, " +
      "addresses, tracking, plus a supportSummary (cancellable? shipped? refund state? payment " +
      "provider). For the customer-facing number (e.g. #101) use nuvemshop_get_order_by_number.",
    {
      order_id: z.number().int().describe("Internal numeric order ID (not the #number)"),
    },
    async (args) => {
      try {
        const order = await nuvemshopApi("GET", `/orders/${args.order_id}`);
        return ok(slimOrder(order));
      } catch (err) {
        if (err && err.status === 404) return fail(orderNotFound(args.order_id));
        return fail(err);
      }
    },
  );

  server.tool(
    "nuvemshop_get_order_by_number",
    "Look up an order by its customer-facing order number (the '#101' the customer sees in " +
      "emails). Returns the same enriched order as nuvemshop_get_order.",
    {
      number: z.number().int().describe("Customer-facing order number, without the '#'"),
    },
    async (args) => {
      try {
        // The list endpoint's `q` matches order numbers; confirm exactly, since
        // q also matches customer names/emails containing the digits.
        const results = await nuvemshopApi("GET", "/orders", {
          query: { q: args.number, per_page: 30 },
        });
        const order = (results ?? []).find((candidate) => candidate.number === args.number);
        if (!order) {
          return fail(
            new Error(
              `No order with number #${args.number}. Double-check the number with the ` +
                "customer, or find their orders with nuvemshop_list_customer_orders.",
            ),
          );
        }
        return ok(slimOrder(order));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "nuvemshop_list_customer_orders",
    "List a customer's orders, most recent first. Find the customer id first with " +
      "nuvemshop_find_customer.",
    {
      customer_id: z.number().int().describe("Numeric customer ID"),
      limit: z.number().int().optional().describe("Max orders to return (default 10)"),
      status: z
        .enum(["any", "open", "closed", "cancelled"])
        .optional()
        .describe("Filter by order status (default any)"),
    },
    async (args) => {
      try {
        const orders = await nuvemshopApi("GET", "/orders", {
          query: {
            customer_ids: args.customer_id,
            status: args.status ?? "any",
            per_page: Math.min(args.limit ?? 10, 200),
          },
        });
        return ok((orders ?? []).map(slimOrder));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "nuvemshop_check_refund_status",
    "Inspect an order's refund situation: current refund state, payment provider, payment " +
      "transactions and value-alteration history when available, and how a refund can actually " +
      "be executed. Always call this before discussing a refund with a customer.",
    {
      order_id: z.number().int().describe("Internal numeric order ID"),
    },
    async (args) => {
      try {
        let order;
        try {
          order = await nuvemshopApi("GET", `/orders/${args.order_id}`);
        } catch (err) {
          if (err && err.status === 404) throw orderNotFound(args.order_id);
          throw err;
        }

        // Transactions and value history are read-only extras; not every store
        // or API version exposes them, so degrade quietly to the order fields.
        let transactions;
        try {
          transactions = await nuvemshopApi("GET", `/orders/${args.order_id}/transactions`);
        } catch {
          transactions = undefined;
        }
        let valueHistory;
        try {
          valueHistory = await nuvemshopApi("GET", `/orders/${args.order_id}/history/values`);
        } catch {
          valueHistory = undefined;
        }

        return ok({
          order: {
            id: order.id,
            number: order.number,
            status: order.status,
            payment_status: order.payment_status,
            total: order.total,
            currency: order.currency,
            gateway: order.gateway,
            gateway_name: order.gateway_name,
            paid_at: order.paid_at,
          },
          supportSummary: orderSupportSummary(order),
          transactions,
          valueHistory,
          howToRefund: HOW_TO_REFUND,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "nuvemshop_cancel_order",
    "Cancel an order (sets status to cancelled, optionally restocks items and emails the " +
      "customer). IMPORTANT: cancelling does NOT refund any payment — for a paid order you must " +
      "pass confirm_paid_cancellation=true and the merchant still refunds via the payment " +
      "provider (see nuvemshop_check_refund_status). Refuses orders that already shipped.",
    {
      order_id: z.number().int().describe("Internal numeric order ID"),
      reason: z
        .enum(["customer", "inventory", "fraud", "other"])
        .describe("Cancellation reason recorded on the order"),
      restock: z.boolean().optional().describe("Return the items to stock (default true)"),
      notify_customer: z
        .boolean()
        .optional()
        .describe("Email the customer about the cancellation (default true)"),
      confirm_paid_cancellation: z
        .boolean()
        .optional()
        .describe(
          "Required (true) when the order is already paid: acknowledges that cancelling " +
            "does not refund the payment and the refund will be handled via the payment provider",
        ),
    },
    async (args) => {
      try {
        // Server-side bounds — enforced here, not in playbook prose.
        let order;
        try {
          order = await nuvemshopApi("GET", `/orders/${args.order_id}`);
        } catch (err) {
          if (err && err.status === 404) throw orderNotFound(args.order_id);
          throw err;
        }
        const summary = orderSupportSummary(order);
        if (order.status === "cancelled") {
          throw new Error(`Order #${order.number} is already cancelled.`);
        }
        if (summary.isShipped) {
          throw new Error(
            `Order #${order.number} has already shipped (shipping_status: ` +
              `${order.shipping_status}) — cancelling it will not recall the shipment. ` +
              "Escalate to the merchant instead.",
          );
        }
        if (order.payment_status === "paid" && args.confirm_paid_cancellation !== true) {
          throw new Error(
            `Order #${order.number} is PAID (${order.total} ${order.currency} via ` +
              `${summary.paymentProvider}). Cancelling will NOT refund this payment. ` +
              "Tell the customer the refund is handled separately by the payment provider, " +
              "then retry with confirm_paid_cancellation=true.",
          );
        }

        const cancelled = await nuvemshopApi("POST", `/orders/${args.order_id}/cancel`, {
          body: {
            reason: args.reason,
            email: args.notify_customer ?? true,
            restock: args.restock ?? true,
          },
        });

        return ok({
          status: "CANCELLED",
          detail:
            order.payment_status === "paid"
              ? "Order cancelled and items " +
                (args.restock === false ? "NOT restocked" : "restocked") +
                ". No money was moved — the payment must still be refunded by the " +
                "payment provider. " +
                HOW_TO_REFUND
              : "Order cancelled. No payment had been captured, so nothing needs refunding.",
          order: slimOrder(cancelled),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "nuvemshop_add_order_note",
    "Add or replace the merchant-facing note on an order (owner_note). Use it to leave an " +
      "audit trail of support actions, e.g. 'Customer requested refund via chat on <date>'.",
    {
      order_id: z.number().int().describe("Internal numeric order ID"),
      note: z.string().describe("The note text (replaces any existing owner note)"),
    },
    async (args) => {
      try {
        const order = await nuvemshopApi("PUT", `/orders/${args.order_id}`, {
          body: { owner_note: args.note },
        });
        return ok({ id: order.id, number: order.number, owner_note: order.owner_note });
      } catch (err) {
        if (err && err.status === 404) return fail(orderNotFound(args.order_id));
        return fail(err);
      }
    },
  );
}

module.exports = { registerOrderTools };
