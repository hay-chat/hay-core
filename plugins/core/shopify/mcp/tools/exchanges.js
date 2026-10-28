// tools/exchanges.js — swap or exchange items on a Shopify order (API 2026-04).
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
}

module.exports = { registerExchangeTools };
