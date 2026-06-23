/**
 * Order tools — the Wix eCommerce Orders API (`/ecom/v1/orders`).
 *
 * Covers finding an order by reference (number / buyer email / status), reading
 * a full order with its status, and reading its transaction history (payments
 * and refunds). These are the read side of the HAY-240 acceptance criteria.
 */

const { z } = require("zod");
const { wixApi } = require("../lib/client");
const { ok, fail, cursorInfo } = require("../lib/format");

/** Wix order statuses, payment statuses and fulfilment statuses, for the agent. */
const ORDER_STATUS = ["INITIALIZED", "APPROVED", "CANCELED"];
const PAYMENT_STATUS = [
  "NOT_PAID",
  "PAID",
  "PARTIALLY_PAID",
  "PARTIALLY_REFUNDED",
  "FULLY_REFUNDED",
  "PENDING",
];
const FULFILLMENT_STATUS = ["NOT_FULFILLED", "PARTIALLY_FULFILLED", "FULFILLED"];

function registerOrderTools(server) {
  server.tool(
    "search_orders",
    "Find Wix orders by reference. Use this first to resolve an order number, buyer email " +
      "or status into an order ID, then call get_order / get_order_transactions / " +
      "get_order_fulfillments with that ID. Returns one page of orders, newest first.",
    {
      orderNumber: z
        .string()
        .optional()
        .describe("The human-facing order number the buyer sees (e.g. 10042)."),
      buyerEmail: z.string().optional().describe("Filter to orders placed by this email address."),
      status: z.enum(ORDER_STATUS).optional().describe("Order status."),
      paymentStatus: z.enum(PAYMENT_STATUS).optional().describe("Payment status."),
      fulfillmentStatus: z.enum(FULFILLMENT_STATUS).optional().describe("Fulfilment status."),
      createdAfter: z
        .string()
        .optional()
        .describe("ISO 8601 date/time; only orders created at or after this moment."),
      filter: z
        .record(z.any())
        .optional()
        .describe(
          "Raw Wix filter object (MongoDB-style), merged with the above. " +
            'Example: {"createdDate": {"$lte": "2024-12-31T23:59:59.000Z"}}.',
        ),
      limit: z.number().optional().describe("Max orders per page (default 20, Wix max 100)."),
      cursor: z
        .string()
        .optional()
        .describe("Cursor from a previous response's nextCursor to fetch the next page."),
    },
    async (args) => {
      try {
        const filter = { ...(args.filter || {}) };
        if (args.orderNumber) filter.number = args.orderNumber;
        if (args.buyerEmail) filter["buyerInfo.email"] = args.buyerEmail;
        if (args.status) filter.status = args.status;
        if (args.paymentStatus) filter.paymentStatus = args.paymentStatus;
        if (args.fulfillmentStatus) filter.fulfillmentStatus = args.fulfillmentStatus;
        if (args.createdAfter) filter.createdDate = { $gte: args.createdAfter };

        const body = {
          filter: Object.keys(filter).length ? filter : undefined,
          sort: [{ fieldName: "createdDate", order: "DESC" }],
          cursorPaging: { limit: args.limit ?? 20, cursor: args.cursor },
        };

        const res = await wixApi("POST", "/ecom/v1/orders/search", { body });
        return ok({ orders: res?.orders ?? [], ...cursorInfo(res) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "get_order",
    "Get a single Wix order by its ID, including line items, totals, buyer info, " +
      "payment status and fulfilment status. Use search_orders first if you only have an " +
      "order number or buyer email.",
    { orderId: z.string().describe("Wix order ID (the `id` field, not the order number).") },
    async ({ orderId }) => {
      try {
        const res = await wixApi("GET", `/ecom/v1/orders/${encodeURIComponent(orderId)}`);
        return ok(res?.order ?? res);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "get_order_transactions",
    "Get the full transaction history for an order — every payment and every refund, with " +
      "their transaction IDs, amounts and statuses. Call this before refund_order so you have " +
      "the real transactionId(s) to refund against.",
    { orderId: z.string().describe("Wix order ID.") },
    async ({ orderId }) => {
      try {
        const res = await wixApi(
          "GET",
          `/ecom/v1/orders/${encodeURIComponent(orderId)}/transactions`,
        );
        return ok(res?.orderTransactions ?? res);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerOrderTools };
