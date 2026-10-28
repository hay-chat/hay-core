// tools/fulfillments.js
// Fulfillment / WISMO (where-is-my-order) tools for the Shopify Admin GraphQL MCP server.
// API version 2026-04.

const { z } = require("zod");
const { shopifyGql } = require("../lib/client");
const { ok, fail, toGid } = require("../lib/format");
const { orderNotFound } = require("./orders");

/**
 * One plain answer for "where is my order", so the agent never has to infer it
 * from an empty list: NOT_SHIPPED (no live fulfillment yet), SHIPPED_NO_TRACKING
 * (shipped, but the store added no tracking number) or HAS_TRACKING.
 */
function trackingState(fulfillments, tracking) {
  const live = fulfillments.filter((f) => !["CANCELLED", "ERROR", "FAILURE"].includes(f.status));
  if (live.length === 0) return "NOT_SHIPPED";
  return tracking.length === 0 ? "SHIPPED_NO_TRACKING" : "HAS_TRACKING";
}

function registerFulfillmentTools(server) {
  server.tool(
    "shopify_get_order_tracking",
    "Get an order's fulfillment and tracking status (WISMO) with a flattened tracking summary. " +
      "trackingState says plainly whether it has shipped and has a tracking number. " +
      "An unknown order id fails with code NOT_FOUND.",
    {
      order_id: z.string().describe("Order GID or bare numeric order id."),
    },
    async (args) => {
      try {
        const id = toGid("Order", args.order_id);
        const QUERY = `
          query GetOrderTracking($id: ID!) {
            order(id: $id) {
              id
              name
              displayFulfillmentStatus
              fulfillments(first: 10) { # Verified 2026-04: Order.fulfillments is a plain [Fulfillment!]! list accepting first:; select fields directly (no edges/node).
                status
                displayStatus
                deliveredAt
                estimatedDeliveryAt
                trackingInfo {
                  number
                  url
                  company
                }
              }
            }
          }
        `;

        const data = await shopifyGql(QUERY, { id });
        const order = data.order;

        if (!order) throw await orderNotFound(args.order_id);

        const tracking = [];
        for (const fulfillment of order.fulfillments || []) {
          for (const info of fulfillment.trackingInfo || []) {
            tracking.push({
              status: fulfillment.status,
              displayStatus: fulfillment.displayStatus,
              deliveredAt: fulfillment.deliveredAt,
              estimatedDeliveryAt: fulfillment.estimatedDeliveryAt,
              number: info.number,
              url: info.url,
              company: info.company,
            });
          }
        }

        return ok({
          id: order.id,
          name: order.name,
          displayFulfillmentStatus: order.displayFulfillmentStatus,
          trackingState: trackingState(order.fulfillments || [], tracking),
          fulfillments: order.fulfillments,
          trackingSummary: tracking,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerFulfillmentTools };
