/**
 * Shared order helpers for the Wix tools: resolve an order by id or number,
 * merge the three reads a support flow needs (order, transactions,
 * fulfilments) into one enriched shape, and compute the support summary the
 * playbooks branch on (isCancellable, isRefundable, remainingRefundable,
 * addressChangeable, tracking).
 *
 * Wix eCommerce REST:
 *   POST /ecom/v1/orders/search                      (filter by number / buyerInfo.email)
 *   GET  /ecom/v1/orders/{id}
 *   GET  /ecom/v1/orders/{id}/transactions           (payments[] + refunds[])
 *   GET  /ecom/v1/orders/{id}/fulfillments           (fulfillments[] with trackingInfo)
 */

const { wixApi } = require("./client");
const { cursorInfo, amountOf, round2 } = require("./format");

const ORDER_STATUS = ["INITIALIZED", "APPROVED", "CANCELED"];
const PAYMENT_STATUS = [
  "NOT_PAID",
  "PAID",
  "PARTIALLY_PAID",
  "PARTIALLY_REFUNDED",
  "FULLY_REFUNDED",
  "PENDING",
];
const FULFILLMENT_STATUS = ["NOT_FULFILLED", "PARTIALLY_FULFILLED", "FULFILLED"];

/** Compact order row for lists (recentOrders, list_customer_orders). */
function summarizeOrder(order) {
  return {
    id: order.id,
    number: order.number,
    createdDate: order.createdDate,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    total: order.priceSummary?.total ?? null,
    currency: order.currency ?? null,
  };
}

/**
 * Search orders. `filter` is a Wix MongoDB-style filter; results newest first.
 * Returns `{ orders, hasNext, nextCursor }`.
 */
async function searchOrders(filter, { limit = 20, cursor } = {}) {
  const body = {
    filter: filter && Object.keys(filter).length ? filter : undefined,
    sort: [{ fieldName: "createdDate", order: "DESC" }],
    cursorPaging: { limit, cursor },
  };
  const res = await wixApi("POST", "/ecom/v1/orders/search", { body });
  return { orders: res?.orders ?? [], ...cursorInfo(res) };
}

async function getOrderById(orderId) {
  const res = await wixApi("GET", `/ecom/v1/orders/${encodeURIComponent(orderId)}`);
  const order = res?.order ?? res;
  if (!order || !order.id) {
    throw new Error(
      `Order ${orderId} not found. Pass the Wix order id, or the order number the buyer sees ` +
        "via order_number, or find it in the recentOrders of wix_find_customer.",
    );
  }
  return order;
}

/**
 * Resolve exactly one order from `{ order_id, order_number }`. The buyer only
 * ever knows the number, so the number path searches by `number`.
 */
async function resolveOrder({ order_id: orderId, order_number: orderNumber }) {
  if (orderId && orderNumber) {
    throw new Error("Pass either order_id or order_number, not both.");
  }
  if (orderId) return getOrderById(orderId);
  if (orderNumber) {
    const { orders } = await searchOrders(
      { number: String(orderNumber).replace(/^#/, "") },
      {
        limit: 1,
      },
    );
    if (!orders.length) {
      throw new Error(
        `No order with number ${orderNumber}. Ask the buyer to double-check the number on their ` +
          "confirmation email, or look the customer up by email with wix_find_customer.",
      );
    }
    return orders[0];
  }
  throw new Error("Pass order_id or order_number.");
}

async function getTransactions(orderId) {
  const res = await wixApi("GET", `/ecom/v1/orders/${encodeURIComponent(orderId)}/transactions`);
  return res?.orderTransactions ?? res ?? {};
}

async function getFulfillments(orderId) {
  const res = await wixApi("GET", `/ecom/v1/orders/${encodeURIComponent(orderId)}/fulfillments`);
  return res?.orderWithFulfillments?.fulfillments ?? res?.fulfillments ?? [];
}

/** Flatten fulfilments into one tracking row per fulfilment. */
function trackingSummary(fulfillments) {
  return (fulfillments || []).map((f) => ({
    fulfillmentId: f.id ?? null,
    createdDate: f.createdDate ?? null,
    status: f.status ?? null,
    trackingNumber: f.trackingInfo?.trackingNumber ?? null,
    carrier: f.trackingInfo?.shippingProvider ?? null,
    trackingUrl: f.trackingInfo?.trackingLink ?? null,
    lineItems: (f.lineItems || []).map((li) => ({
      id: li.id ?? li.lineItemId,
      quantity: li.quantity,
    })),
  }));
}

/**
 * Per-payment refundable balance from the transactions payload:
 * payment amount minus every non-failed refund already booked against it.
 */
function paymentBalances(transactions) {
  const refundedByPayment = {};
  for (const refund of transactions?.refunds || []) {
    for (const tx of refund.transactions || []) {
      if (String(tx.refundStatus || "").toUpperCase() === "FAILED") continue;
      const key = tx.paymentId;
      refundedByPayment[key] = round2((refundedByPayment[key] || 0) + amountOf(tx.amount));
    }
  }
  return (transactions?.payments || []).map((p) => {
    const details =
      p.regularPaymentDetails || p.giftcardPaymentDetails || p.membershipPaymentDetails || {};
    const paid = amountOf(p.amount);
    const refunded = refundedByPayment[p.id] || 0;
    return {
      paymentId: p.id,
      status: details.status ?? null,
      paymentMethod: details.paymentMethod ?? (p.giftcardPaymentDetails ? "GIFT_CARD" : null),
      offline: Boolean(details.offlinePayment),
      refundDisabled: Boolean(p.refundDisabled),
      paid,
      refunded,
      remaining: round2(Math.max(0, paid - refunded)),
    };
  });
}

/**
 * Merge order + transactions + fulfilments and derive the support summary.
 * `transactions` / `fulfillments` may be null when a secondary read failed —
 * the summary then degrades (flags still computed from the order itself).
 */
function enrichOrder(order, transactions, fulfillments) {
  const payments = transactions ? paymentBalances(transactions) : [];
  const paidFromTx = round2(payments.reduce((s, p) => s + p.paid, 0));
  const refundedFromTx = round2(payments.reduce((s, p) => s + p.refunded, 0));
  // balanceSummary is authoritative when present; transactions are the fallback.
  const paid = order.balanceSummary?.paid ? amountOf(order.balanceSummary.paid) : paidFromTx;
  const refunded = order.balanceSummary?.refunded
    ? amountOf(order.balanceSummary.refunded)
    : refundedFromTx;
  const remainingRefundable = round2(Math.max(0, paid - refunded));

  const notCanceled = order.status !== "CANCELED";
  const unfulfilled = (order.fulfillmentStatus || "NOT_FULFILLED") === "NOT_FULFILLED";
  const tracking = trackingSummary(fulfillments);

  return {
    ...order,
    lineItems: (order.lineItems || []).map((li) => ({
      id: li.id,
      name: li.productName?.translated || li.productName?.original || null,
      sku: li.physicalProperties?.sku ?? null,
      quantity: li.quantity,
      price: li.price ?? null,
      total: li.totalPriceAfterTax ?? li.totalPriceBeforeTax ?? null,
      options: li.descriptionLines ?? null,
    })),
    payments,
    tracking,
    supportSummary: {
      isCancellable: notCanceled && unfulfilled,
      isRefundable: notCanceled ? remainingRefundable > 0 : remainingRefundable > 0,
      remainingRefundable: {
        amount: remainingRefundable.toFixed(2),
        currency: order.currency ?? null,
      },
      addressChangeable: notCanceled && unfulfilled,
      deliveredAt: null, // Wix does not expose delivery confirmation on fulfilments.
      shippedAt: tracking.length ? tracking[0].createdDate : null,
    },
  };
}

/** Read the three endpoints a support flow needs; secondary reads degrade to null. */
async function loadEnrichedOrder(order) {
  const [transactions, fulfillments] = await Promise.all([
    getTransactions(order.id).catch((err) => {
      console.error(`[wix] transactions read failed for ${order.id}: ${err.message}`);
      return null;
    }),
    getFulfillments(order.id).catch((err) => {
      console.error(`[wix] fulfillments read failed for ${order.id}: ${err.message}`);
      return null;
    }),
  ]);
  return enrichOrder(order, transactions, fulfillments);
}

module.exports = {
  ORDER_STATUS,
  PAYMENT_STATUS,
  FULFILLMENT_STATUS,
  summarizeOrder,
  searchOrders,
  getOrderById,
  resolveOrder,
  getTransactions,
  getFulfillments,
  trackingSummary,
  paymentBalances,
  enrichOrder,
  loadEnrichedOrder,
};
