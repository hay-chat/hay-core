/**
 * Order tools — reads are rich (one call merges order + transactions +
 * fulfilments), writes are narrow with server-side bounds.
 *
 *   wix_get_order                     GET order (+ transactions + fulfillments)
 *   wix_get_order_tracking            GET fulfillments
 *   wix_cancel_order                  POST /ecom/v1/orders/{id}/cancel     (pre-dispatch only)
 *   wix_update_order_shipping_address PATCH /ecom/v1/orders/{id}           (pre-dispatch only)
 */

const { z } = require("zod");
const { wixApi } = require("../lib/client");
const { ok, fail } = require("../lib/format");
const {
  resolveOrder,
  loadEnrichedOrder,
  getFulfillments,
  trackingSummary,
  balanceRemaining,
} = require("../lib/orders");

const ORDER_REF = {
  order_id: z.string().optional().describe("Wix order id (the `id` field)."),
  order_number: z
    .string()
    .optional()
    .describe("The order number the buyer sees (e.g. 10042). Use when you have no id."),
};

/** Shared pre-dispatch guard for cancel / address change. */
function assertPreDispatch(order, action) {
  const ref = order.number ? `#${order.number}` : order.id;
  if (order.status === "CANCELED") {
    throw new Error(`Order ${ref} is already cancelled; cannot ${action}.`);
  }
  if ((order.fulfillmentStatus || "NOT_FULFILLED") !== "NOT_FULFILLED") {
    throw new Error(
      `Order ${ref} has fulfilment status ${order.fulfillmentStatus}; you can only ${action} before ` +
        "dispatch. Escalate to the merchant/carrier instead.",
    );
  }
}

function registerOrderTools(server) {
  server.tool(
    "wix_get_order",
    "Get an order by id or order number, with line items, totals, shipping address, payments, " +
      "tracking and a supportSummary (isCancellable, isRefundable, remainingRefundable, " +
      "addressChangeable). One call answers status, refund and cancellation questions.",
    ORDER_REF,
    async (args) => {
      try {
        const order = await resolveOrder(args);
        return ok(await loadEnrichedOrder(order));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "wix_get_order_tracking",
    "Get an order's shipment tracking (where-is-my-order): fulfilment status plus one row per " +
      "shipment with carrier, tracking number and tracking link.",
    ORDER_REF,
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const fulfillments = await getFulfillments(order.id);
        return ok({
          id: order.id,
          number: order.number,
          fulfillmentStatus: order.fulfillmentStatus,
          tracking: trackingSummary(fulfillments),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "wix_cancel_order",
    "Cancel an order that has not been dispatched (WRITE). Refuses once any item is fulfilled. " +
      "Optionally restocks items and emails the buyer. Cancelling does not refund — call " +
      "wix_create_refund for the money.",
    {
      ...ORDER_REF,
      restock: z.boolean().optional().describe("Restock all items (default true)."),
      notify_customer: z
        .boolean()
        .optional()
        .describe("Send Wix's order-cancelled email to the buyer (default false)."),
      message: z.string().optional().describe("Custom message included in the cancellation email."),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        assertPreDispatch(order, "cancel");
        const body = {
          restockAllItems: args.restock ?? true,
          sendOrderCanceledEmail: Boolean(args.notify_customer),
        };
        if (args.message) body.customMessage = args.message;
        const res = await wixApi("POST", `/ecom/v1/orders/${encodeURIComponent(order.id)}/cancel`, {
          body,
        });
        const updated = res?.order ?? {};
        const remaining = balanceRemaining(order);
        return ok({
          status: "CANCELLED",
          id: order.id,
          number: order.number,
          orderStatus: updated.status ?? "CANCELED",
          remainingRefundable:
            remaining === null
              ? null
              : { amount: remaining.toFixed(2), currency: order.currency ?? null },
          detail:
            "The order is cancelled. If the buyer paid, refund them with wix_create_refund — " +
            "cancelling alone does not move money.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "wix_update_order_shipping_address",
    "Change where an undispatched order ships (WRITE). Refuses once fulfilment has started. " +
      "Only the fields you pass change; the rest of the address is kept.",
    {
      ...ORDER_REF,
      address: z
        .object({
          addressLine1: z.string().optional(),
          addressLine2: z.string().optional(),
          city: z.string().optional(),
          subdivision: z.string().optional().describe('ISO 3166-2 subdivision code, e.g. "US-CA".'),
          postalCode: z.string().optional(),
          country: z.string().optional().describe('ISO 3166-1 alpha-2 country code, e.g. "US".'),
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          phone: z.string().optional(),
          company: z.string().optional(),
        })
        .describe("Fields to change on the shipping destination."),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        assertPreDispatch(order, "change the shipping address");

        const current = order.shippingInfo?.logistics?.shippingDestination || {};
        const address = { ...(current.address || {}) };
        const contact = { ...(current.contactDetails || {}) };
        const a = args.address;
        // Wix address objects spell the first line either `addressLine` or
        // `addressLine1` depending on the API that wrote them — keep whichever
        // the order already uses.
        const line1Key = "addressLine" in address ? "addressLine" : "addressLine1";
        if (a.addressLine1 !== undefined) address[line1Key] = a.addressLine1;
        if (a.addressLine2 !== undefined) address.addressLine2 = a.addressLine2;
        if (a.city !== undefined) address.city = a.city;
        if (a.subdivision !== undefined) address.subdivision = a.subdivision;
        if (a.postalCode !== undefined) address.postalCode = a.postalCode;
        if (a.country !== undefined) address.country = a.country;
        if (a.firstName !== undefined) contact.firstName = a.firstName;
        if (a.lastName !== undefined) contact.lastName = a.lastName;
        if (a.phone !== undefined) contact.phone = a.phone;
        if (a.company !== undefined) contact.company = a.company;

        // TODO(verify against a live site): Update Order accepts
        // shippingInfo.logistics.shippingDestination; the request shape below
        // follows the eCom Orders API docs (order object + field mask).
        const res = await wixApi("PATCH", `/ecom/v1/orders/${encodeURIComponent(order.id)}`, {
          body: {
            order: {
              id: order.id,
              shippingInfo: {
                logistics: { shippingDestination: { address, contactDetails: contact } },
              },
            },
            fieldMask: ["shippingInfo.logistics.shippingDestination"],
          },
        });
        const updated = res?.order ?? {};
        return ok({
          id: order.id,
          number: order.number,
          shippingDestination: updated.shippingInfo?.logistics?.shippingDestination ?? {
            address,
            contactDetails: contact,
          },
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerOrderTools, assertPreDispatch };
