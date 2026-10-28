/**
 * Order tools — rich reads, narrow bounded writes.
 *
 *   woocommerce_get_order                      GET /orders/{id} + tracking lookup
 *   woocommerce_get_order_tracking             tracking lookup (plugins, meta, order notes)
 *   woocommerce_cancel_order                   PUT /orders/{id} {status: cancelled}   pre-dispatch only
 *   woocommerce_update_order_shipping_address  PUT /orders/{id} {shipping}            pre-dispatch only
 *   woocommerce_add_order_note                 POST /orders/{id}/notes
 */

const { z } = require("zod");
const { wcApi } = require("../lib/client");
const { ok, fail, toolError } = require("../lib/format");
const {
  resolveOrder,
  getTracking,
  getRefundDetails,
  getStoreCountry,
  enrichOrder,
  PRE_DISPATCH_STATUSES,
} = require("../lib/orders");
const { isPreDispatch } = require("../lib/orders");

const ORDER_REF = {
  order_id: z.string().optional().describe("WooCommerce order id."),
  order_number: z
    .string()
    .optional()
    .describe("The order number the customer sees (e.g. 12345). Use when you have no id."),
};

/** Refuse once anything has shipped: wrong status, or tracking already recorded. */
async function assertPreDispatch(order, action) {
  if (order.status === "cancelled") {
    throw toolError(
      "PRECONDITION",
      `Order #${order.number} is already cancelled; cannot ${action}.`,
      {
        details: { reason: "ALREADY_CANCELLED" },
      },
    );
  }
  if (!PRE_DISPATCH_STATUSES.has(order.status)) {
    throw toolError(
      "PRECONDITION",
      `Order #${order.number} has status "${order.status}"; you can only ${action} while it is ` +
        "pending, on-hold or processing (before dispatch). Escalate to the merchant instead.",
      { details: { reason: "NOT_PRE_DISPATCH", status: order.status } },
    );
  }
  const tracking = await getTracking(order);
  if (!isPreDispatch(order, tracking)) {
    throw toolError(
      "PRECONDITION",
      `Order #${order.number} already has shipment tracking (${tracking
        .map((t) => t.trackingNumber)
        .join(", ")}); it has left the warehouse, so you cannot ${action}. Escalate to the ` +
        "merchant/carrier instead.",
      {
        details: {
          reason: "ALREADY_SHIPPED",
          trackingNumbers: tracking.map((t) => t.trackingNumber),
        },
      },
    );
  }
}

function registerOrderTools(server) {
  server.tool(
    "woocommerce_get_order",
    "Get an order by id or number with line items, totals, addresses, payment method and " +
      "transaction id, refunds with dates, shipment tracking, and for an unpaid order its " +
      "payment link and Pix copy-paste code (pix) when the store's gateway saved one, " +
      "and a supportSummary (isCancellable, isRefundable, remainingRefundable, addressChangeable, " +
      "tracking: isStale/daysSinceLastUpdate/staleReason). " +
      "One call answers status, refund and cancellation questions.",
    ORDER_REF,
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const [tracking, refundDetails, originCountry] = await Promise.all([
          getTracking(order),
          getRefundDetails(order),
          getStoreCountry(),
        ]);
        return ok(enrichOrder(order, tracking, { refundDetails, originCountry }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_get_order_tracking",
    "Get an order's shipment tracking (where-is-my-order). Reads the store's shipment-tracking " +
      "plugin (official Shipment Tracking, Advanced Shipment Tracking, VillaTheme Orders " +
      "Tracking, YITH Order Tracking), the order's tracking meta, or a tracking number written " +
      "in the order notes. An empty list means nothing has been recorded yet.",
    ORDER_REF,
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const tracking = await getTracking(order);
        return ok({
          id: order.id,
          number: order.number,
          status: order.status,
          dateCompleted: order.date_completed ?? null,
          tracking,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_cancel_order",
    "Cancel an order that has not been dispatched (WRITE): only pending, on-hold or processing " +
      "orders with no shipment tracking yet. WooCommerce restocks the items. Cancelling does not " +
      "refund — call woocommerce_create_refund for the money.",
    {
      ...ORDER_REF,
      note: z.string().optional().describe("Internal note explaining the cancellation."),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        await assertPreDispatch(order, "cancel");
        const updated = await wcApi("PUT", `/orders/${order.id}`, {
          body: { status: "cancelled" },
        });
        if (args.note) {
          await wcApi("POST", `/orders/${order.id}/notes`, {
            body: { note: args.note, customer_note: false },
          });
        }
        return ok({
          status: "CANCELLED",
          id: order.id,
          number: order.number,
          orderStatus: updated?.status ?? "cancelled",
          detail: order.date_paid
            ? "The order is cancelled. The customer paid, so refund them with woocommerce_create_refund — cancelling alone does not move money."
            : "The order is cancelled. No payment was recorded, so nothing to refund.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_update_order_shipping_address",
    "Change where an undispatched order ships (WRITE): only pending, on-hold or processing " +
      "orders with no shipment tracking yet. Only the fields you pass change; the rest of the " +
      "address is kept.",
    {
      ...ORDER_REF,
      address: z
        .object({
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          company: z.string().optional(),
          address_1: z.string().optional(),
          address_2: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional().describe('State/province code, e.g. "CA".'),
          postcode: z.string().optional(),
          country: z.string().optional().describe('ISO 3166-1 alpha-2 country code, e.g. "US".'),
          phone: z.string().optional(),
        })
        .describe("Fields to change on the shipping address."),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        await assertPreDispatch(order, "change the shipping address");
        const shipping = { ...(order.shipping || {}), ...args.address };
        const updated = await wcApi("PUT", `/orders/${order.id}`, { body: { shipping } });
        return ok({
          id: order.id,
          number: order.number,
          shippingAddress: updated?.shipping ?? shipping,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_add_order_note",
    "Add an internal note to an order (WRITE). Set customer_note=true to also email it to the " +
      "customer as an order update.",
    {
      ...ORDER_REF,
      note: z.string().describe("Note text."),
      customer_note: z
        .boolean()
        .optional()
        .describe("Send the note to the customer (default false)."),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const note = await wcApi("POST", `/orders/${order.id}/notes`, {
          body: { note: args.note, customer_note: Boolean(args.customer_note) },
        });
        return ok({
          id: order.id,
          number: order.number,
          noteId: note?.id ?? null,
          note: note?.note ?? args.note,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerOrderTools, assertPreDispatch, ORDER_REF };
