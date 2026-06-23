// tools/fulfillments.js
// Fulfillment / WISMO (where-is-my-order) tools for the Shopify Admin GraphQL MCP server.
// API version 2026-04.

const { z } = require("zod");
const { shopifyGql } = require("../lib/client");
const {
  ok,
  fail,
  unwrapConnection,
  pageInfo,
  toGid,
  assertNoUserErrors,
} = require("../lib/format");

function registerFulfillmentTools(server) {
  server.tool(
    "shopify_get_order_tracking",
    "Get an order's fulfillment and tracking status (WISMO) with a flattened tracking summary.",
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

        if (!order) {
          return ok(null);
        }

        const tracking = [];
        for (const fulfillment of order.fulfillments || []) {
          for (const info of fulfillment.trackingInfo || []) {
            tracking.push({
              status: fulfillment.status,
              displayStatus: fulfillment.displayStatus,
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
