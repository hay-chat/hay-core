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

// Payment states where the customer's money is still in play: captured (paid),
// partially returned, or held on the card (authorized).
const MONEY_IN_PLAY = new Set(["paid", "partially_refunded", "authorized"]);

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
        // The list endpoint's `q` is a contains-match over order numbers AND
        // customer names/emails, so #101 also surfaces #1010, #2101 and every
        // customer like joao101@… — page through ALL matches (status any, so
        // closed/cancelled orders are findable too) and confirm exactly. Only
        // report not-found once the match set is exhausted.
        const perPage = 50;
        const maxPages = 10; // 500 q-matches; beyond that the number is wrong anyway
        for (let page = 1; page <= maxPages; page++) {
          const { data, total } = await nuvemshopApi("GET", "/orders", {
            query: { q: args.number, status: "any", per_page: perPage, page },
            withMeta: true,
          });
          const results = data ?? [];
          const order = results.find((candidate) => Number(candidate.number) === args.number);
          if (order) return ok(slimOrder(order));
          const exhausted =
            results.length < perPage || (total !== undefined && page * perPage >= total);
          if (exhausted) break;
        }
        return fail(
          new Error(
            `No order with number #${args.number}. Double-check the number with the ` +
              "customer, or find their orders with nuvemshop_list_customer_orders.",
          ),
        );
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
      "customer). IMPORTANT: cancelling does NOT refund payments or release card holds — when " +
      "the order is paid, partially refunded or authorized you must pass " +
      "confirm_paid_cancellation=true, and the merchant still handles the money via the payment " +
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
          "Required (true) when the customer's money is involved (order paid, partially " +
            "refunded, or an authorization hold active): acknowledges that cancelling does " +
            "not refund or release anything — the payment provider handles the money",
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
        // Money guard: any state where the customer's money is still in play —
        // captured (paid), partially returned (partially_refunded: the remainder
        // is still with the merchant), or held (authorized: the card hold must
        // be voided/released by the provider).
        if (MONEY_IN_PLAY.has(order.payment_status) && args.confirm_paid_cancellation !== true) {
          const moneyDetail =
            order.payment_status === "authorized"
              ? "has an active authorization hold that cancelling will NOT void or release"
              : order.payment_status === "partially_refunded"
                ? "was only PARTIALLY refunded — the remainder stays with the merchant; " +
                  "cancelling will NOT refund it"
                : "is PAID; cancelling will NOT refund the payment";
          throw new Error(
            `Order #${order.number} (${order.total} ${order.currency} via ` +
              `${summary.paymentProvider}) ${moneyDetail}. Tell the customer the money ` +
              "is handled separately by the payment provider, then retry with " +
              "confirm_paid_cancellation=true.",
          );
        }

        const cancelled = await nuvemshopApi("POST", `/orders/${args.order_id}/cancel`, {
          body: {
            reason: args.reason,
            email: args.notify_customer ?? true,
            restock: args.restock ?? true,
          },
        });

        const restockDetail =
          "Order cancelled and items " + (args.restock === false ? "NOT restocked" : "restocked");
        let moneyOutcome;
        if (order.payment_status === "authorized") {
          moneyOutcome =
            ". The card authorization hold was NOT released — the payment provider must " +
            "void it (otherwise it sits on the customer's card until it expires).";
        } else if (
          order.payment_status === "paid" ||
          order.payment_status === "partially_refunded"
        ) {
          moneyOutcome =
            ". No money was moved — the " +
            (order.payment_status === "partially_refunded" ? "remaining balance" : "payment") +
            " must still be refunded by the payment provider. " +
            HOW_TO_REFUND;
        } else if (order.payment_status === "refunded" || order.payment_status === "voided") {
          moneyOutcome = `. The payment was already ${order.payment_status} — nothing left to return.`;
        } else {
          moneyOutcome = ". No payment had been captured, so nothing needs refunding.";
        }

        return ok({
          status: "CANCELLED",
          detail: restockDetail + moneyOutcome,
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
