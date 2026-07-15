// tools/orders.js — Shopify Admin GraphQL MCP tools for orders (API version 2026-04).
// Registrar: registerOrderTools. Design: reads are rich (one call answers the whole
// support flow), writes are narrow (server-side bounds, not prompt-level guidance).

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

// Shared field set for single-order reads. Precomputes everything the support
// playbooks branch on (refund eligibility, cancellability, delivery) so the agent
// needs one call, not four. Verified against 2026-04 docs: refundable,
// netPaymentSet, totalRefundedSet, cancelledAt, closedAt, Fulfillment.deliveredAt
// all exist; there is NO Order.cancelable field.
const ORDER_SUPPORT_FIELDS = `
  id
  name
  email
  createdAt
  cancelledAt
  closedAt
  displayFinancialStatus
  displayFulfillmentStatus
  returnStatus
  refundable
  note
  totalPriceSet { shopMoney { amount currencyCode } }
  totalRefundedSet { shopMoney { amount currencyCode } }
  netPaymentSet { shopMoney { amount currencyCode } }
  shippingAddress {
    address1
    address2
    city
    provinceCode
    zip
    countryCode
    firstName
    lastName
    phone
    company
  }
  customer { id displayName defaultEmailAddress { emailAddress } }
  fulfillments(first: 10) {
    status
    displayStatus
    deliveredAt
    estimatedDeliveryAt
    trackingInfo { number url company }
  }
  lineItems(first: 100) {
    edges { node { id title quantity sku } }
  }
`;

// Fulfillment statuses under which changing the shipping address still makes
// sense — nothing has left the warehouse yet.
const PRE_DISPATCH_STATUSES = new Set(["UNFULFILLED", "SCHEDULED", "ON_HOLD"]);

/**
 * Flatten line items and add a derived support summary. `isCancellable` is a
 * heuristic (Shopify exposes no cancelable field): not cancelled, not closed,
 * nothing fulfilled yet. `orderCancel` remains the source of truth via userErrors.
 */
function enrichOrder(order) {
  if (!order) return null;
  const deliveredAt =
    (order.fulfillments || [])
      .map((f) => f.deliveredAt)
      .filter(Boolean)
      .sort()
      .pop() || null;

  return {
    ...order,
    lineItems: unwrapConnection(order.lineItems),
    supportSummary: {
      isCancellable:
        !order.cancelledAt && !order.closedAt && order.displayFulfillmentStatus === "UNFULFILLED",
      isRefundable: !!order.refundable,
      // Net payment = captured minus already refunded; the hard ceiling for refunds.
      remainingRefundable: order.netPaymentSet ? order.netPaymentSet.shopMoney : null,
      deliveredAt,
      addressChangeable: PRE_DISPATCH_STATUSES.has(order.displayFulfillmentStatus),
    },
  };
}

/**
 * Build an actionable not-found error for an order lookup. The most common
 * mistake is passing a Customer id where an Order id belongs (both are bare
 * numbers), so probe for that and name it explicitly — a bare "not found"
 * strands the agent with no recovery path.
 */
async function orderNotFound(rawId) {
  const probeId = toGid("Customer", String(rawId).split("/").pop());
  try {
    const probe = await shopifyGql(
      `query ProbeCustomer($id: ID!) { customer(id: $id) { id displayName } }`,
      { id: probeId },
    );
    if (probe.customer) {
      return new Error(
        `No order with id ${rawId} — that id belongs to customer ` +
          `"${probe.customer.displayName}". Their recent orders (with order ids) are in the ` +
          "recentOrders field of shopify_find_customer / shopify_get_customer.",
      );
    }
  } catch {
    // Probe is best-effort; fall through to the generic message.
  }
  return new Error(
    `Order ${rawId} not found. Get a valid order id from the recentOrders field of ` +
      'shopify_find_customer / shopify_get_customer, or use shopify_get_order_by_name ("#1001").',
  );
}

function registerOrderTools(server) {
  server.tool(
    "shopify_get_order",
    "Get an order with line items, totals, shipping address, tracking, and a supportSummary " +
      "(isCancellable, isRefundable, remainingRefundable, deliveredAt, addressChangeable).",
    {
      order_id: z.string().describe("Order GID (gid://shopify/Order/123) or bare numeric id."),
    },
    async (args) => {
      try {
        const id = toGid("Order", args.order_id);
        const QUERY = `
          query GetOrder($id: ID!) {
            order(id: $id) { ${ORDER_SUPPORT_FIELDS} }
          }
        `;
        const data = await shopifyGql(QUERY, { id });
        if (!data.order) throw await orderNotFound(args.order_id);
        return ok(enrichOrder(data.order));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_get_order_by_name",
    'Look up an order by its human-readable name (e.g. "#1001"). Returns the same enriched ' +
      "shape as shopify_get_order, including the supportSummary.",
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
              edges { node { ${ORDER_SUPPORT_FIELDS} } }
            }
          }
        `;
        const data = await shopifyGql(QUERY, { query: `name:"${args.name}"` });
        const first = unwrapConnection(data.orders)[0];
        if (!first) {
          throw new Error(
            `No order named "${args.name}" found. Order names usually include the "#" prefix ` +
              '(e.g. "#1001"); or find the order via the customer\'s recentOrders.',
          );
        }
        return ok(enrichOrder(first));
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
        if (!data.customer) {
          throw new Error(
            `Customer ${args.customer_id} not found; get a valid customer id from ` +
              "shopify_find_customer (email/phone).",
          );
        }
        const conn = data.customer.orders;
        return ok({ items: unwrapConnection(conn), pageInfo: pageInfo(conn) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // NOTE: no broad order-search tool on purpose. A customer-facing agent must only
  // see orders belonging to the verified customer (shopify_list_customer_orders);
  // a store-wide search is a data-exposure vector under prompt injection.

  server.tool(
    "shopify_update_order_shipping_address",
    "Update the shipping address of an order that has not been dispatched (WRITE). " +
      "Refuses if any items are already fulfilled or in progress — this changes where " +
      "the ORDER ships, unlike editing the customer's profile address.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
      address: z
        .object({
          address1: z.string().optional(),
          address2: z.string().optional(),
          city: z.string().optional(),
          provinceCode: z
            .string()
            .optional()
            .describe('Province/state code, e.g. "CA". (province by name is deprecated).'),
          countryCode: z
            .string()
            .optional()
            .describe('ISO country code, e.g. "US". (country by name is deprecated).'),
          zip: z.string().optional(),
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          phone: z.string().optional(),
          company: z.string().optional(),
        })
        .describe("New shipping address; overwrites the order's existing shipping address."),
    },
    async (args) => {
      try {
        const id = toGid("Order", args.order_id);

        // Server-side bound: only pre-dispatch orders. Once anything shipped, an
        // address change silently does nothing useful and misleads the customer.
        const CHECK = `
          query CheckDispatch($id: ID!) {
            order(id: $id) { id name displayFulfillmentStatus cancelledAt }
          }
        `;
        const check = await shopifyGql(CHECK, { id });
        if (!check.order) throw await orderNotFound(args.order_id);
        if (check.order.cancelledAt) {
          throw new Error(`Order ${check.order.name} is cancelled; cannot change its address.`);
        }
        if (!PRE_DISPATCH_STATUSES.has(check.order.displayFulfillmentStatus)) {
          throw new Error(
            `Order ${check.order.name} has fulfillment status ` +
              `${check.order.displayFulfillmentStatus}; the shipping address can only be ` +
              "changed before dispatch. Escalate to the merchant/carrier instead.",
          );
        }

        const MUTATION = `
          mutation UpdateOrderShippingAddress($input: OrderInput!) {
            orderUpdate(input: $input) {
              order {
                id
                name
                shippingAddress {
                  address1 address2 city provinceCode zip countryCode firstName lastName phone company
                }
              }
              userErrors { field message }
            }
          }
        `;
        const data = await shopifyGql(MUTATION, {
          input: { id, shippingAddress: args.address },
        });
        assertNoUserErrors(data.orderUpdate);
        return ok(data.orderUpdate.order);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_calculate_refund",
    "Calculate the correct refund for an order BEFORE executing it (READ). Returns Shopify's " +
      "suggested amounts (subtotal, tax, shipping, maximum refundable) and the transactions to " +
      "pass to shopify_create_refund. Always call this first; never compute refund math yourself.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
      refund_line_items: z
        .array(
          z.object({
            lineItemId: z.string().describe("LineItem GID."),
            quantity: z.number().int().describe("Quantity to refund."),
          }),
        )
        .optional()
        .describe("Line items to include; omit with suggest_full_refund for a full refund."),
      refund_shipping: z.boolean().optional().describe("Include shipping in the refund."),
      suggest_full_refund: z
        .boolean()
        .optional()
        .describe("Ask Shopify to suggest a full refund of the remaining balance."),
    },
    async (args) => {
      try {
        const id = toGid("Order", args.order_id);
        const QUERY = `
          query CalculateRefund(
            $id: ID!
            $refundLineItems: [RefundLineItemInput!]
            $refundShipping: Boolean
            $suggestFullRefund: Boolean
          ) {
            order(id: $id) {
              id
              name
              refundable
              netPaymentSet { shopMoney { amount currencyCode } }
              suggestedRefund(
                refundLineItems: $refundLineItems
                refundShipping: $refundShipping
                suggestFullRefund: $suggestFullRefund
              ) {
                amountSet { shopMoney { amount currencyCode } }
                maximumRefundableSet { shopMoney { amount currencyCode } }
                subtotalSet { shopMoney { amount currencyCode } }
                totalTaxSet { shopMoney { amount currencyCode } }
                refundLineItems {
                  lineItem { id title }
                  quantity
                  subtotalSet { shopMoney { amount currencyCode } }
                  totalTaxSet { shopMoney { amount currencyCode } }
                }
                shipping {
                  amountSet { shopMoney { amount currencyCode } }
                  maximumRefundableSet { shopMoney { amount currencyCode } }
                }
                suggestedTransactions {
                  amountSet { shopMoney { amount currencyCode } }
                  gateway
                  parentTransaction { id }
                }
              }
            }
          }
        `;
        const data = await shopifyGql(QUERY, {
          id,
          refundLineItems: args.refund_line_items ?? null,
          refundShipping: args.refund_shipping ?? null,
          suggestFullRefund: args.suggest_full_refund ?? null,
        });
        if (!data.order) throw await orderNotFound(args.order_id);
        return ok(data.order);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_cancel_order",
    "Cancel an order (WRITE). Optionally restock, refund, and notify the customer. " +
      "Fails with Shopify's reason if the order is not cancellable (e.g. already fulfilled).",
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
        // orderCancel is async: no userErrors means the cancellation was accepted
        // and WILL complete; job.done=false only means Shopify is still processing.
        // Say so explicitly, or the raw job payload reads as "not done yet".
        return ok({
          status: "CANCELLATION_ACCEPTED",
          detail:
            "Shopify accepted the cancellation and is processing it (async job). " +
            "It is safe to tell the customer the order has been cancelled.",
          ...data.orderCancel,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "shopify_create_refund",
    "Execute a refund for an order (WRITE). Call shopify_calculate_refund first and pass its " +
      "suggested transactions. Bounded server-side: rejects non-refundable orders and amounts " +
      "exceeding the order's remaining refundable balance. Idempotent via idempotency_key (UUID).",
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
        .describe("Transactions to process for the refund (from shopify_calculate_refund)."),
      idempotency_key: z
        .string()
        .describe("UUID idempotency key; required by Shopify 2026-04 for refund mutations."),
    },
    async (args) => {
      try {
        const orderId = toGid("Order", args.order_id);

        // Server-side bounds — enforced here, not in playbook prose: never refund a
        // non-refundable order, never exceed the remaining refundable balance.
        const CHECK = `
          query CheckRefundable($id: ID!) {
            order(id: $id) {
              id
              name
              refundable
              netPaymentSet { shopMoney { amount currencyCode } }
            }
          }
        `;
        const check = await shopifyGql(CHECK, { id: orderId });
        if (!check.order) throw new Error(`Order ${args.order_id} not found.`);
        if (!check.order.refundable) {
          throw new Error(
            `Order ${check.order.name} is not refundable (already fully refunded or no ` +
              "eligible payment transactions).",
          );
        }
        if (args.transactions && args.transactions.length > 0) {
          const requested = args.transactions.reduce((sum, t) => sum + Number(t.amount), 0);
          const remaining = Number(check.order.netPaymentSet.shopMoney.amount);
          if (!Number.isFinite(requested) || requested <= 0) {
            throw new Error(`Invalid refund transaction amounts (total ${requested}).`);
          }
          if (requested > remaining + 0.001) {
            throw new Error(
              `Refund of ${requested} exceeds the remaining refundable balance of ` +
                `${remaining} ${check.order.netPaymentSet.shopMoney.currencyCode} for order ` +
                `${check.order.name}. Use shopify_calculate_refund to get correct amounts.`,
            );
          }
        }

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

        // Verified 2026-04: @idempotent(key:) is documented and MANDATORY for refund
        // mutations from this API version (shopify.dev/docs/api/usage/idempotent-requests).
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
