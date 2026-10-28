// tools/exchanges.js — swap or exchange items on a Shopify order (API 2026-04).
//
// shopify_create_exchange (D6-11): after delivery, a Shopify return with exchange line
// items (returnCreate) that is then processed (returnProcess) so the replacement ships.
// Refuses when the shopper would owe money.
//
// shopify_swap_order_item (D6-10): before dispatch, replace a line item with another
// variant of the same product (a different size or colour) through an order edit.
// Server-side bounds: the order has not shipped, the new variant is in stock and
// costs the same or less, and the edit leaves nothing for the shopper to pay. If any
// bound fails the edit is never committed (an uncommitted order edit is discarded).
//
// Both tools are "exchange" writes, so Hay.chat core holds them for approval.

const { z } = require("zod");
const { shopifyGql } = require("../lib/client");
const { requireScopes } = require("../lib/scopes");
const { orderNotFound, cancelBlocker } = require("./orders");
const { ok, fail, toolError, toGid, assertNoUserErrors } = require("../lib/format");

const num = (v) => Number.parseFloat(v ?? "0") || 0;
const moneyOf = (set) => (set && set.shopMoney) || null;

const SWAP_CONTEXT = `
  query SwapContext($orderId: ID!, $variantId: ID!) {
    order(id: $orderId) {
      id
      name
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      fulfillments(first: 10) { status displayStatus }
      lineItems(first: 100) {
        nodes {
          id
          title
          currentQuantity
          unfulfilledQuantity
          variant { id title product { id } }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
    productVariant(id: $variantId) {
      id
      title
      price
      availableForSale
      inventoryQuantity
      inventoryPolicy
      inventoryItem { tracked }
      product { id title }
    }
  }
`;

const EDIT_BEGIN = `
  mutation OrderEditBegin($id: ID!) {
    orderEditBegin(id: $id) {
      calculatedOrder { id lineItems(first: 100) { nodes { id quantity variant { id } } } }
      userErrors { field message }
    }
  }
`;

const EDIT_SET_QUANTITY = `
  mutation OrderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
    orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: true) {
      calculatedLineItem { id quantity }
      userErrors { field message }
    }
  }
`;

const EDIT_ADD_VARIANT = `
  mutation OrderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
    orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: true) {
      calculatedLineItem { id quantity }
      calculatedOrder { id totalOutstandingSet { shopMoney { amount currencyCode } } }
      userErrors { field message }
    }
  }
`;

const EDIT_COMMIT = `
  mutation OrderEditCommit($id: ID!, $staffNote: String) {
    orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
      order { id name }
      userErrors { field message }
    }
  }
`;

const EXCHANGE_CONTEXT = `
  query ExchangeContext($orderId: ID!, $variantIds: [ID!]!) {
    order(id: $orderId) { id name cancelledAt }
    returnableFulfillments(orderId: $orderId, first: 10) {
      nodes {
        returnableFulfillmentLineItems(first: 50) {
          nodes {
            quantity
            fulfillmentLineItem {
              id
              lineItem {
                id
                title
                discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
    nodes(ids: $variantIds) {
      ... on ProductVariant {
        id
        title
        price
        availableForSale
        inventoryQuantity
        inventoryPolicy
        inventoryItem { tracked }
        product { title }
      }
    }
  }
`;

const RETURN_CREATE_EXCHANGE = `
  mutation CreateExchange($returnInput: ReturnInput!) {
    returnCreate(returnInput: $returnInput) {
      return {
        id
        status
        name
        returnLineItems(first: 50) { nodes { id quantity } }
        exchangeLineItems(first: 50) { nodes { id quantity lineItems { id title variant { id } } } }
      }
      userErrors { field message }
    }
  }
`;

const RETURN_PROCESS = `
  mutation ProcessExchange($input: ReturnProcessInput!) {
    returnProcess(input: $input) {
      return { id status }
      userErrors { field message }
    }
  }
`;

const refuse = (message, details) => toolError("PRECONDITION", message, { details });

/** True when the variant can ship `quantity` more units right now. */
function inStock(variant, quantity) {
  if (!variant.availableForSale) return false;
  if (variant.inventoryItem && variant.inventoryItem.tracked === false) return true;
  if (variant.inventoryPolicy === "CONTINUE") return true;
  return (variant.inventoryQuantity ?? 0) >= quantity;
}

/** The calculated line item for the original line: same numeric id, else same variant. */
function findCalculatedLine(calculatedOrder, lineItem) {
  const lines =
    (calculatedOrder && calculatedOrder.lineItems && calculatedOrder.lineItems.nodes) || [];
  const numericId = String(lineItem.id).split("/").pop();
  return (
    lines.find((l) => String(l.id).split("/").pop() === numericId) ||
    lines.find((l) => l.variant && lineItem.variant && l.variant.id === lineItem.variant.id) ||
    null
  );
}

function registerExchangeTools(server) {
  server.tool(
    "shopify_swap_order_item",
    "Swap an item on an order that has NOT shipped yet for another variant of the same product " +
      "(e.g. size M -> size L) by editing the order (WRITE). Refuses when the order has shipped, " +
      "the new variant is out of stock or costs more, or the shopper would owe money; then " +
      "offer an exchange after delivery or hand the conversation to the store team. Confirm the " +
      "exact item and new variant with the customer first. Shopify emails the customer the " +
      "updated order. Only say the swap happened if this tool returns swapped: true.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
      line_item_id: z
        .string()
        .describe("LineItem GID of the item to replace (lineItems[].id from shopify_get_order)."),
      new_variant_id: z
        .string()
        .describe("ProductVariant GID or numeric id of the replacement (same product)."),
      quantity: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("How many units to swap. Defaults to every unshipped unit of the line."),
    },
    async (args) => {
      try {
        const orderId = toGid("Order", args.order_id);
        const variantId = toGid("ProductVariant", args.new_variant_id);
        const lineItemId = toGid("LineItem", args.line_item_id);

        const ctx = await shopifyGql(SWAP_CONTEXT, { orderId, variantId });
        const order = ctx.order;
        if (!order) throw await orderNotFound(args.order_id);

        const blocker = cancelBlocker(order);
        if (blocker) {
          throw refuse(
            blocker.reason === "ALREADY_CANCELLED"
              ? `Order ${order.name} is cancelled, so its items can't be swapped.`
              : `Order ${order.name} has already shipped or is being fulfilled, so the item ` +
                  "can't be swapped now. Offer an exchange once it arrives, or hand the " +
                  "conversation to the store team.",
            { reason: blocker.reason },
          );
        }

        const line = (order.lineItems.nodes || []).find((l) => l.id === lineItemId);
        if (!line) {
          throw toolError(
            "NOT_FOUND",
            `Line item ${args.line_item_id} is not on order ${order.name}. Use lineItems[].id ` +
              "from shopify_get_order.",
          );
        }
        const variant = ctx.productVariant;
        if (!variant) {
          throw toolError("NOT_FOUND", `Variant ${args.new_variant_id} not found.`);
        }
        if (line.variant && variant.id === line.variant.id) {
          throw toolError("BAD_INPUT", "The new variant is the same as the one already ordered.");
        }
        if (
          !line.variant ||
          !line.variant.product ||
          variant.product.id !== line.variant.product.id
        ) {
          throw refuse(
            "A swap can only change the size or colour of the same product. For a different " +
              "product, hand the conversation to the store team.",
            { reason: "DIFFERENT_PRODUCT" },
          );
        }

        const available = line.unfulfilledQuantity ?? line.currentQuantity ?? 0;
        const quantity = args.quantity ?? available;
        if (quantity < 1 || quantity > available) {
          throw toolError(
            "BAD_INPUT",
            `Only ${available} unit(s) of "${line.title}" can be swapped on order ${order.name}.`,
          );
        }

        const unitPaid = moneyOf(line.originalUnitPriceSet);
        if (unitPaid && num(variant.price) > num(unitPaid.amount)) {
          throw refuse(
            `"${variant.title}" costs more (${variant.price} ${unitPaid.currencyCode}) than the ` +
              `item ordered (${unitPaid.amount}). A swap can't ask the shopper to pay more; hand ` +
              "the conversation to the store team.",
            { reason: "PRICE_HIGHER", newPrice: variant.price, paidUnitPrice: unitPaid.amount },
          );
        }
        if (!inStock(variant, quantity)) {
          throw refuse(`"${variant.product.title} - ${variant.title}" is out of stock.`, {
            reason: "OUT_OF_STOCK",
          });
        }

        // Fail cleanly before opening an edit when the store hasn't re-approved Hay.chat.
        await requireScopes(["write_order_edits"]);

        const begin = await shopifyGql(EDIT_BEGIN, { id: orderId });
        assertNoUserErrors(begin.orderEditBegin);
        const calculatedOrder = begin.orderEditBegin.calculatedOrder;
        const calcLine = findCalculatedLine(calculatedOrder, line);
        if (!calcLine) {
          throw toolError("INTERNAL", "Shopify's order edit did not include the original item.");
        }

        const setQty = await shopifyGql(EDIT_SET_QUANTITY, {
          id: calculatedOrder.id,
          lineItemId: calcLine.id,
          quantity: calcLine.quantity - quantity,
        });
        assertNoUserErrors(setQty.orderEditSetQuantity);

        const added = await shopifyGql(EDIT_ADD_VARIANT, {
          id: calculatedOrder.id,
          variantId,
          quantity,
        });
        assertNoUserErrors(added.orderEditAddVariant);

        // A discount on the original line can make the new line cost more even at the same
        // list price. Never commit an edit that leaves the shopper owing money.
        const outstanding = moneyOf(added.orderEditAddVariant.calculatedOrder?.totalOutstandingSet);
        if (outstanding && num(outstanding.amount) > 0.005) {
          throw refuse(
            `The swap would leave ${outstanding.amount} ${outstanding.currencyCode} for the ` +
              "shopper to pay, so nothing was changed. Hand the conversation to the store team.",
            { reason: "BALANCE_DUE", outstanding },
          );
        }

        const commit = await shopifyGql(EDIT_COMMIT, {
          id: calculatedOrder.id,
          staffNote: `Hay.chat: swapped ${quantity} x "${line.title}" for "${variant.title}" at the customer's request.`,
        });
        assertNoUserErrors(commit.orderEditCommit);

        // Negative outstanding = the store owes the shopper the difference. Shopify does not
        // refund it automatically; say so instead of implying it happened.
        const owedToShopper =
          outstanding && num(outstanding.amount) < -0.005
            ? {
                amount: Math.abs(num(outstanding.amount)).toFixed(2),
                currencyCode: outstanding.currencyCode,
              }
            : null;
        return ok({
          swapped: true,
          order: commit.orderEditCommit.order,
          removed: {
            lineItemId: line.id,
            title: line.title,
            variant: line.variant.title,
            quantity,
          },
          added: {
            variantId: variant.id,
            title: variant.product.title,
            variant: variant.title,
            quantity,
          },
          customerNotified: true,
          owedToShopper,
          note: owedToShopper
            ? `The new item costs less: the store owes the shopper ${owedToShopper.amount} ` +
              `${owedToShopper.currencyCode}. No refund was made; use shopify_create_refund if the ` +
              "store refunds the difference."
            : undefined,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
  server.tool(
    "shopify_create_exchange",
    "Exchange delivered items for other variants (e.g. a different size) (WRITE). Opens a " +
      "Shopify return with exchange items and processes it, so the replacement is released for " +
      "fulfillment and the customer is notified. Use fulfillmentLineItem ids from " +
      "shopify_get_returnable_items. Refuses when a replacement is out of stock or the " +
      "replacements cost more than the returned items (the shopper would owe money): then hand " +
      "the conversation to the store team. Confirm items and variants with the customer first. " +
      "Only say the exchange happened if this tool returns exchanged: true.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
      return_line_items: z
        .array(
          z.object({
            fulfillmentLineItemId: z
              .string()
              .describe("FulfillmentLineItem GID from shopify_get_returnable_items."),
            quantity: z.number().int().positive().describe("Quantity coming back."),
            returnReasonNote: z
              .string()
              .optional()
              .describe("The customer's reason (max 255 chars)."),
          }),
        )
        .min(1)
        .describe("Items the customer sends back."),
      exchange_items: z
        .array(
          z.object({
            variantId: z.string().describe("ProductVariant GID or numeric id to send instead."),
            quantity: z.number().int().positive().describe("Quantity to send."),
          }),
        )
        .min(1)
        .describe("Replacement items to ship."),
    },
    async (args) => {
      try {
        const orderId = toGid("Order", args.order_id);
        const exchangeItems = args.exchange_items.map((e) => ({
          variantId: toGid("ProductVariant", e.variantId),
          quantity: e.quantity,
        }));
        const ctx = await shopifyGql(EXCHANGE_CONTEXT, {
          orderId,
          variantIds: exchangeItems.map((e) => e.variantId),
        });
        if (!ctx.order) throw await orderNotFound(args.order_id);
        if (ctx.order.cancelledAt) {
          throw refuse(`Order ${ctx.order.name} is cancelled, so it can't be exchanged.`, {
            reason: "ALREADY_CANCELLED",
          });
        }

        // Price what comes back from the returnable items Shopify lists.
        const returnable = new Map();
        for (const f of (ctx.returnableFulfillments && ctx.returnableFulfillments.nodes) || []) {
          for (const r of (f.returnableFulfillmentLineItems &&
            f.returnableFulfillmentLineItems.nodes) ||
            []) {
            returnable.set(r.fulfillmentLineItem.id, r);
          }
        }
        let currency = null;
        let returnedValue = 0;
        for (const item of args.return_line_items) {
          const r = returnable.get(item.fulfillmentLineItemId);
          if (!r || item.quantity > r.quantity) {
            throw refuse(
              `Item ${item.fulfillmentLineItemId} can't be returned in that quantity. Use ` +
                "shopify_get_returnable_items for what is returnable.",
              { reason: "NOT_RETURNABLE", fulfillmentLineItemId: item.fulfillmentLineItemId },
            );
          }
          const paid = moneyOf(
            r.fulfillmentLineItem.lineItem.discountedUnitPriceAfterAllDiscountsSet,
          );
          currency = currency || (paid && paid.currencyCode);
          returnedValue += num(paid && paid.amount) * item.quantity;
        }

        const variants = new Map((ctx.nodes || []).filter(Boolean).map((v) => [v.id, v]));
        let exchangeValue = 0;
        for (const e of exchangeItems) {
          const v = variants.get(e.variantId);
          if (!v) throw toolError("NOT_FOUND", `Variant ${e.variantId} not found.`);
          if (!inStock(v, e.quantity)) {
            throw refuse(`"${v.product.title} - ${v.title}" is out of stock.`, {
              reason: "OUT_OF_STOCK",
              variantId: v.id,
            });
          }
          exchangeValue += num(v.price) * e.quantity;
        }
        if (exchangeValue - returnedValue > 0.005) {
          throw refuse(
            `The replacements cost ${exchangeValue.toFixed(2)} ${currency || ""} and the returned ` +
              `items ${returnedValue.toFixed(2)}, so the shopper would owe the difference. Nothing ` +
              "was changed; hand the conversation to the store team.",
            { reason: "BALANCE_DUE", exchangeValue, returnedValue },
          );
        }

        await requireScopes(["write_returns"]);

        const returnLineItems = args.return_line_items.map((li) => {
          const item = { fulfillmentLineItemId: li.fulfillmentLineItemId, quantity: li.quantity };
          if (li.returnReasonNote !== undefined) item.returnReasonNote = li.returnReasonNote;
          return item;
        });
        const created = await shopifyGql(RETURN_CREATE_EXCHANGE, {
          returnInput: { orderId, returnLineItems, exchangeLineItems: exchangeItems },
        });
        assertNoUserErrors(created.returnCreate);
        const ret = created.returnCreate.return;

        // If processing fails the return still exists (OPEN): say so instead of implying
        // nothing happened, so the agent hands off rather than retrying into a duplicate.
        let processed;
        try {
          processed = await shopifyGql(RETURN_PROCESS, {
            input: {
              returnId: ret.id,
              returnLineItems: ret.returnLineItems.nodes.map((n) => ({
                id: n.id,
                quantity: n.quantity,
              })),
              exchangeLineItems: ret.exchangeLineItems.nodes.map((n) => ({
                id: n.id,
                quantity: n.quantity,
              })),
              notifyCustomer: true,
            },
          });
          assertNoUserErrors(processed.returnProcess);
        } catch (err) {
          err.message = `${err.message} Return ${ret.name} was created but not processed; hand the conversation to the store team.`;
          err.details = { ...(err.details || {}), returnId: ret.id, returnCreated: true };
          throw err;
        }

        const difference = returnedValue - exchangeValue;
        return ok({
          exchanged: true,
          return: { id: ret.id, name: ret.name, status: processed.returnProcess.return.status },
          replacements: ret.exchangeLineItems.nodes.flatMap((n) => n.lineItems || []),
          customerNotified: true,
          owedToShopper:
            difference > 0.005 ? { amount: difference.toFixed(2), currencyCode: currency } : null,
          note:
            difference > 0.005
              ? `The replacements cost less: the store owes the shopper ${difference.toFixed(2)} ` +
                `${currency || ""}. No refund was made.`
              : undefined,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerExchangeTools };
