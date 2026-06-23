// tools/orders.js — Shopify Admin GraphQL MCP tools for orders (API version 2026-04).
// Registrar: registerOrderTools. Read/write tools for fetching, searching, and mutating orders.

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

function registerOrderTools(server) {
  server.tool(
    "shopify_get_order",
    "Get a single order with line items, totals, and customer by GID or numeric id.",
    {
      order_id: z.string().describe("Order GID (gid://shopify/Order/123) or bare numeric id."),
    },
    async (args) => {
      try {
        const id = toGid("Order", args.order_id);
        const QUERY = `
          query GetOrder($id: ID!) {
            order(id: $id) {
              id
              name
              email
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              note
              totalPriceSet { shopMoney { amount currencyCode } }
              customer { id displayName email }
              lineItems(first: 100) {
                edges { node { id title quantity sku } }
              }
            }
          }
        `;
        const data = await shopifyGql(QUERY, { id });
        return ok(data.order);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_get_order_by_name",
    'Look up an order by its human-readable name (e.g. "#1001").',
    {
      name: z.string().describe('Order name including any prefix, e.g. "#1001".'),
    },
    async (args) => {
      try {
        // OrderIdentifierInput has no `name` field (only id / customId), so look
        // an order up by its name via the orders search query. Verified 2026-04.
        const QUERY = `
          query GetOrderByName($query: String!) {
            orders(first: 1, query: $query) {
              edges {
                node {
                  id
                  name
                  displayFinancialStatus
                  displayFulfillmentStatus
                  note
                }
              }
            }
          }
        `;
        const data = await shopifyGql(QUERY, { query: `name:"${args.name}"` });
        const first = unwrapConnection(data.orders)[0];
        return ok(first || null);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_get_order_status",
    "Get the financial and fulfillment status of an order.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
    },
    async (args) => {
      try {
        const id = toGid("Order", args.order_id);
        const QUERY = `
          query GetOrderStatus($id: ID!) {
            order(id: $id) {
              id
              name
              displayFinancialStatus
              displayFulfillmentStatus
            }
          }
        `;
        const data = await shopifyGql(QUERY, { id });
        return ok(data.order);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_list_customer_orders",
    "List a customer's orders, most recent first.",
    {
      customer_id: z.string().describe("Customer GID or bare numeric id."),
      limit: z.number().int().optional().describe("Max orders to return (default 10)."),
    },
    async (args) => {
      try {
        const id = toGid("Customer", args.customer_id);
        const first = args.limit ?? 10;
        const QUERY = `
          query ListCustomerOrders($id: ID!, $first: Int!) {
            customer(id: $id) {
              orders(first: $first, sortKey: CREATED_AT, reverse: true) {
                edges {
                  node {
                    id
                    name
                    createdAt
                    displayFinancialStatus
                    displayFulfillmentStatus
                    totalPriceSet { shopMoney { amount currencyCode } }
                  }
                }
              }
            }
          }
        `;
        const data = await shopifyGql(QUERY, { id, first });
        const conn = data.customer ? data.customer.orders : null;
        return ok({ items: unwrapConnection(conn), pageInfo: pageInfo(conn) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_search_orders",
    "Search orders with optional filters and cursor pagination. Returns { items, pageInfo }.",
    {
      query: z
        .string()
        .optional()
        .describe("Raw Shopify search query; merged with the structured filters below."),
      limit: z.number().int().optional().describe("Max orders to return (default 20)."),
      cursor: z.string().optional().describe("Pagination cursor (endCursor from a prior page)."),
      financialStatus: z
        .string()
        .optional()
        .describe('financial_status filter, e.g. "paid", "refunded".'),
      fulfillmentStatus: z
        .string()
        .optional()
        .describe('fulfillment_status filter, e.g. "unfulfilled", "fulfilled".'),
      createdAfter: z.string().optional().describe("ISO date; filters created_at >= value."),
      createdBefore: z.string().optional().describe("ISO date; filters created_at <= value."),
    },
    async (args) => {
      try {
        const first = args.limit ?? 20;
        const after = args.cursor ?? null;

        const parts = [];
        if (args.query) parts.push(args.query);
        if (args.financialStatus) parts.push(`financial_status:${args.financialStatus}`);
        if (args.fulfillmentStatus) parts.push(`fulfillment_status:${args.fulfillmentStatus}`);
        if (args.createdAfter) parts.push(`created_at:>=${args.createdAfter}`);
        if (args.createdBefore) parts.push(`created_at:<=${args.createdBefore}`);
        const query = parts.length ? parts.join(" ") : null;

        const QUERY = `
          query SearchOrders($first: Int!, $after: String, $query: String) {
            orders(first: $first, after: $after, query: $query) {
              edges {
                node {
                  id
                  name
                  createdAt
                  displayFinancialStatus
                  displayFulfillmentStatus
                }
                cursor
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        `;
        const data = await shopifyGql(QUERY, { first, after, query });
        return ok({ items: unwrapConnection(data.orders), pageInfo: pageInfo(data.orders) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_cancel_order",
    "Cancel an order (WRITE). Optionally restock, refund, and notify the customer.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
      reason: z
        .enum(["CUSTOMER", "DECLINED", "FRAUD", "INVENTORY", "OTHER", "STAFF"])
        .describe("Cancellation reason."),
      restock: z.boolean().describe("Whether to restock line items."),
      refund_to_original_payment: z
        .boolean()
        .optional()
        .describe(
          "If true, refund to the original payment method; if omitted, no refundMethod is sent.",
        ),
      notify_customer: z
        .boolean()
        .optional()
        .describe("Whether to notify the customer of the cancellation."),
      staff_note: z.string().optional().describe("Internal staff note for the cancellation."),
    },
    async (args) => {
      try {
        const orderId = toGid("Order", args.order_id);
        const variables = {
          orderId,
          reason: args.reason,
          restock: args.restock,
          notify: args.notify_customer ?? null,
          note: args.staff_note ?? null,
        };
        // Verified 2026-04: orderCancel requires orderId/reason/restock; refundMethod
        // is optional (OrderCancelRefundMethodInput). TODO(HAY-219 §8): the exact
        // OrderCancelRefundMethodInput subfield (originalPaymentMethodsRefund) is a
        // best-guess — confirm against a dev store before relying on refunds-on-cancel.
        if (args.refund_to_original_payment !== undefined) {
          variables.refundMethod = args.refund_to_original_payment
            ? { originalPaymentMethodsRefund: true }
            : null;
        } else {
          variables.refundMethod = null;
        }
        const MUTATION = `
          mutation CancelOrder(
            $orderId: ID!
            $reason: OrderCancelReason!
            $restock: Boolean!
            $refundMethod: OrderCancelRefundMethodInput
            $notify: Boolean
            $note: String
          ) {
            orderCancel(
              orderId: $orderId
              reason: $reason
              restock: $restock
              refundMethod: $refundMethod
              notifyCustomer: $notify
              staffNote: $note
            ) {
              job { id done }
              orderCancelUserErrors { field message code }
              userErrors { field message }
            }
          }
        `;
        const data = await shopifyGql(MUTATION, variables);
        assertNoUserErrors(data.orderCancel, "orderCancelUserErrors");
        assertNoUserErrors(data.orderCancel);
        return ok(data.orderCancel);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_create_refund",
    "Create a refund for an order (WRITE). Idempotent via idempotency_key.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
      note: z.string().optional().describe("Refund note."),
      notify: z.boolean().optional().describe("Whether to notify the customer."),
      refund_line_items: z
        .array(
          z.object({
            lineItemId: z.string().describe("LineItem GID."),
            quantity: z.number().int().describe("Quantity to refund."),
            restockType: z
              .string()
              .optional()
              .describe("Restock type, e.g. RETURN, CANCEL, NO_RESTOCK."),
          }),
        )
        .optional()
        .describe("Line items to refund."),
      shipping_amount: z
        .string()
        .optional()
        .describe("Shipping amount to refund (decimal string)."),
      transactions: z
        .array(
          z.object({
            parentId: z.string().describe("Parent transaction GID."),
            amount: z.string().describe("Amount to refund (decimal string)."),
            gateway: z.string().describe("Payment gateway."),
            kind: z.string().describe("Transaction kind, e.g. REFUND."),
          }),
        )
        .optional()
        .describe("Transactions to process for the refund."),
      idempotency_key: z
        .string()
        .describe("Idempotency key to make refund creation safe to retry."),
    },
    async (args) => {
      try {
        const orderId = toGid("Order", args.order_id);

        const input = { orderId };
        if (args.note !== undefined) input.note = args.note;
        if (args.notify !== undefined) input.notify = args.notify;
        if (args.refund_line_items) {
          input.refundLineItems = args.refund_line_items.map((li) => {
            const item = { lineItemId: li.lineItemId, quantity: li.quantity };
            if (li.restockType !== undefined) item.restockType = li.restockType;
            return item;
          });
        }
        if (args.shipping_amount !== undefined) {
          input.shipping = { amount: args.shipping_amount };
        }
        if (args.transactions) {
          input.transactions = args.transactions.map((t) => ({
            parentId: t.parentId,
            amount: t.amount,
            gateway: t.gateway,
            kind: t.kind,
          }));
        }

        // TODO(HAY-219 §8): verify RefundLineItemInput.restockType, ShippingRefundInput shape,
        // OrderTransactionInput.kind enum, and the @idempotent(key:) directive against a real dev store.
        const MUTATION = `
          mutation CreateRefund($input: RefundInput!, $key: String!) {
            refundCreate(input: $input) @idempotent(key: $key) {
              order { id name }
              refund {
                id
                totalRefundedSet { shopMoney { amount currencyCode } }
              }
              userErrors { field message }
            }
          }
        `;
        const data = await shopifyGql(MUTATION, { input, key: args.idempotency_key });
        assertNoUserErrors(data.refundCreate);
        return ok(data.refundCreate);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_add_order_note",
    "Add or replace the note on an order (WRITE).",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
      note: z.string().describe("Note text to set on the order."),
    },
    async (args) => {
      try {
        const id = toGid("Order", args.order_id);
        const MUTATION = `
          mutation AddOrderNote($id: ID!, $note: String!) {
            orderUpdate(input: { id: $id, note: $note }) {
              order { id note }
              userErrors { field message }
            }
          }
        `;
        const data = await shopifyGql(MUTATION, { id, note: args.note });
        assertNoUserErrors(data.orderUpdate);
        return ok(data.orderUpdate);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerOrderTools };
