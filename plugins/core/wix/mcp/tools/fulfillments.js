/**
 * Fulfilment tools — the Wix eCommerce Order Fulfillments API
 * (`/ecom/v1/fulfillments` and `/ecom/v1/orders/{orderId}/fulfillments`).
 *
 * Lets the agent read an order's fulfilment status and create/update/remove
 * fulfilments (marking items shipped with tracking). Covers the "read order
 * fulfilment and status" criterion plus the order-changes the ticket mentions.
 */

const { z } = require("zod");
const { wixApi } = require("../lib/client");
const { ok, fail } = require("../lib/format");

function registerFulfillmentTools(server) {
  server.tool(
    "get_order_fulfillments",
    "List the fulfilments for an order — what has shipped, the line items in each fulfilment, " +
      "and tracking info. Use get_order for the order's overall fulfilmentStatus.",
    { orderId: z.string().describe("Wix order ID.") },
    async ({ orderId }) => {
      try {
        const res = await wixApi(
          "GET",
          `/ecom/v1/orders/${encodeURIComponent(orderId)}/fulfillments`,
        );
        return ok(res?.orderWithFulfillments?.fulfillments ?? res?.fulfillments ?? res);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "create_fulfillment",
    "Mark line items of an order as fulfilled (shipped), optionally with tracking. Omit " +
      "lineItems to fulfil the whole order. Each line item can only belong to one fulfilment.",
    {
      orderId: z.string().describe("Wix order ID."),
      lineItems: z
        .array(
          z.object({
            lineItemId: z.string().describe("The order line item ID (from get_order)."),
            quantity: z.number().describe("Quantity of this line item being fulfilled."),
          }),
        )
        .optional()
        .describe("Specific line items + quantities to fulfil. Omit to fulfil all items."),
      trackingNumber: z.string().optional().describe("Carrier tracking number."),
      shippingProvider: z
        .string()
        .optional()
        .describe('Carrier name, e.g. "fedex", "ups", "usps", "dhl" (auto-links tracking).'),
      trackingLink: z
        .string()
        .optional()
        .describe("Tracking URL (needed for custom/unknown carriers)."),
    },
    async (args) => {
      try {
        const fulfillment = {};
        if (args.lineItems) fulfillment.lineItems = args.lineItems;
        if (args.trackingNumber || args.shippingProvider || args.trackingLink) {
          fulfillment.trackingInfo = {
            trackingNumber: args.trackingNumber,
            shippingProvider: args.shippingProvider,
            trackingLink: args.trackingLink,
          };
        }
        const res = await wixApi("POST", "/ecom/v1/fulfillments", {
          body: { orderId: args.orderId, fulfillment },
        });
        return ok(res);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "update_fulfillment",
    "Update an existing fulfilment's tracking info (e.g. add or correct a tracking number).",
    {
      orderId: z.string().describe("Wix order ID."),
      fulfillmentId: z.string().describe("Fulfilment ID (from get_order_fulfillments)."),
      trackingNumber: z.string().optional().describe("Carrier tracking number."),
      shippingProvider: z.string().optional().describe("Carrier name."),
      trackingLink: z.string().optional().describe("Tracking URL."),
    },
    async (args) => {
      try {
        const trackingInfo = {
          trackingNumber: args.trackingNumber,
          shippingProvider: args.shippingProvider,
          trackingLink: args.trackingLink,
        };
        const res = await wixApi(
          "PATCH",
          `/ecom/v1/fulfillments/${encodeURIComponent(args.fulfillmentId)}`,
          {
            body: { orderId: args.orderId, fulfillment: { id: args.fulfillmentId, trackingInfo } },
          },
        );
        return ok(res);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "delete_fulfillment",
    "Remove a fulfilment from an order (e.g. created by mistake). This reverts those line " +
      "items to not-fulfilled.",
    {
      orderId: z.string().describe("Wix order ID."),
      fulfillmentId: z.string().describe("Fulfilment ID to delete."),
    },
    async ({ orderId, fulfillmentId }) => {
      try {
        const res = await wixApi(
          "DELETE",
          `/ecom/v1/fulfillments/${encodeURIComponent(fulfillmentId)}`,
          { query: { orderId } },
        );
        return ok(res ?? { deleted: true, fulfillmentId });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerFulfillmentTools };
