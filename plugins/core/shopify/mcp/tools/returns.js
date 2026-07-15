// tools/returns.js — Shopify Admin GraphQL MCP tools for returns (API 2026-04).
// Returns are a different object from refunds: a return manages the item coming
// back (approve → restock → then refund); a refund only moves money. The support
// flow is: shopify_get_returnable_items → shopify_create_return → (once received)
// shopify_calculate_refund → shopify_create_refund.
//
// Requires the read_returns / write_returns OAuth scopes (added alongside this
// module — previously connected stores must reconnect).

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

function registerReturnTools(server) {
  server.tool(
    "shopify_get_returnable_items",
    "List the fulfilled line items on an order that are eligible for a return, with the " +
      "fulfillmentLineItem ids and quantities needed by shopify_create_return.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
    },
    async (args) => {
      try {
        const orderId = toGid("Order", args.order_id);
        const QUERY = `
          query GetReturnableItems($orderId: ID!) {
            returnableFulfillments(orderId: $orderId, first: 10) {
              edges {
                node {
                  id
                  fulfillment { id displayStatus deliveredAt }
                  returnableFulfillmentLineItems(first: 50) {
                    edges {
                      node {
                        fulfillmentLineItem {
                          id
                          lineItem { id title sku }
                        }
                        quantity
                      }
                    }
                  }
                }
              }
            }
          }
        `;
        const data = await shopifyGql(QUERY, { orderId });
        const fulfillments = unwrapConnection(data.returnableFulfillments).map((f) => ({
          id: f.id,
          fulfillment: f.fulfillment,
          returnableItems: unwrapConnection(f.returnableFulfillmentLineItems),
        }));
        return ok({
          items: fulfillments,
          pageInfo: pageInfo(data.returnableFulfillments),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_create_return",
    "Create a return for fulfilled items on an order (WRITE). The return is created in OPEN " +
      "state — confirm with the customer first. Use fulfillmentLineItem ids from " +
      "shopify_get_returnable_items. Refund the money separately once the return is resolved.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
      return_line_items: z
        .array(
          z.object({
            fulfillmentLineItemId: z
              .string()
              .describe("FulfillmentLineItem GID from shopify_get_returnable_items."),
            quantity: z.number().int().describe("Quantity to return."),
            returnReasonNote: z
              .string()
              .optional()
              .describe("Free-text reason from the customer (max 255 chars)."),
          }),
        )
        .min(1)
        .describe("Items to include in the return."),
    },
    async (args) => {
      try {
        const orderId = toGid("Order", args.order_id);
        // Verified 2026-04: ReturnInput takes orderId + returnLineItems; notifyCustomer
        // and ReturnLineItemInput.returnReason are deprecated (reason definitions would
        // need a separate returnReasonDefinitionId lookup — free-text note suffices here).
        const returnLineItems = args.return_line_items.map((li) => {
          const item = {
            fulfillmentLineItemId: li.fulfillmentLineItemId,
            quantity: li.quantity,
          };
          if (li.returnReasonNote !== undefined) item.returnReasonNote = li.returnReasonNote;
          return item;
        });
        const MUTATION = `
          mutation CreateReturn($returnInput: ReturnInput!) {
            returnCreate(returnInput: $returnInput) {
              return {
                id
                status
                order { id name }
              }
              userErrors { field message }
            }
          }
        `;
        const data = await shopifyGql(MUTATION, {
          returnInput: { orderId, returnLineItems },
        });
        assertNoUserErrors(data.returnCreate);
        return ok(data.returnCreate.return);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerReturnTools };
