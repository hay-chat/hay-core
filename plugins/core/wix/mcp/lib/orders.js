/**
 * Shared order helpers for the Wix tools: resolve an order by id or number,
 * merge the three reads a support flow needs (order, transactions,
 * fulfilments) into one enriched shape, and compute the support summary the
 * playbooks branch on (isCancellable, isRefundable, remainingRefundable,
 * addressChangeable, tracking).
 *
 * Wix eCommerce REST:
 *   POST /ecom/v1/orders/search                      body { search: { filter, sort, cursorPaging } }
 *   GET  /ecom/v1/orders/{id}
 *   GET  /ecom/v1/orders/{id}/transactions           (payments[] + refunds[])
 *   GET  /ecom/v1/orders/{id}/fulfillments           (fulfillments[] with trackingInfo)
 */

const { staleTracking, stalestShipment } = require("@hay/plugin-sdk/stale-tracking");
const { wixApi } = require("./client");
const { cursorInfo, amountOf, round2 } = require("./format");

const sameEmail = (a, b) =>
  String(a || "")
    .trim()
    .toLowerCase() ===
  String(b || "")
    .trim()
    .toLowerCase();

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
 * Returns `{ orders, hasNext, nextCursor }`. Callers must still verify the
 * rows match what they asked for: Wix silently ignores unknown body keys, so
 * a malformed filter returns the store's newest orders instead of an error.
 */
async function searchOrders(filter, { limit = 20, cursor } = {}) {
  const search = {
    sort: [{ fieldName: "createdDate", order: "DESC" }],
    cursorPaging: { limit, cursor },
  };
  if (filter && Object.keys(filter).length) search.filter = filter;
  const res = await wixApi("POST", "/ecom/v1/orders/search", { body: { search } });
  return { orders: res?.orders ?? [], ...cursorInfo(res) };
}

/** Orders whose buyer email actually matches (exact, case-insensitive). */
async function searchOrdersByEmail(email, paging) {
  const page = await searchOrders({ "buyerInfo.email": email }, paging);
  return { ...page, orders: page.orders.filter((o) => sameEmail(o.buyerInfo?.email, email)) };
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
 * ever knows the number, so the number path searches by `number` and then
 * verifies the hit really carries that number.
 */
async function resolveOrder({ order_id: orderId, order_number: orderNumber }) {
  if (orderId && orderNumber) {
    throw new Error("Pass either order_id or order_number, not both.");
  }
  if (orderId) return getOrderById(orderId);
  if (orderNumber) {
    const wanted = String(orderNumber).replace(/^#/, "").trim();
    const { orders } = await searchOrders({ number: wanted }, { limit: 1 });
    const match = orders.find((o) => String(o.number) === wanted);
    if (!match) {
      throw new Error(
        `No order with number ${wanted}. Ask the buyer to double-check the number on their ` +
          "confirmation email, or look the customer up by email with wix_find_customer.",
      );
    }
    return match;
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

/** paid − refunded from the order's own balanceSummary; null when Wix did not send one. */
function balanceRemaining(order) {
  if (!order.balanceSummary?.paid) return null;
  const paid = amountOf(order.balanceSummary.paid);
  const refunded = order.balanceSummary.refunded ? amountOf(order.balanceSummary.refunded) : 0;
  return round2(Math.max(0, paid - refunded));
}

function contactOf(details) {
  if (!details) return null;
  return {
    firstName: details.firstName ?? null,
    lastName: details.lastName ?? null,
    phone: details.phone ?? null,
    company: details.company ?? null,
  };
}

let storeCountryPromise = null;

/**
 * The site's business country (Site Properties), cached per MCP process; null
 * when the key cannot read it (the shorter domestic threshold then applies).
 */
function getStoreCountry() {
  if (!storeCountryPromise) {
    storeCountryPromise = wixApi("GET", "/site-properties/v4/properties")
      .then((res) => res?.properties?.address?.country || null)
      .catch(() => {
        storeCountryPromise = null; // retry on the next order read
        return null;
      });
  }
  return storeCountryPromise;
}

/**
 * D6-9 stale flag: days since each fulfilment was created. Wix fulfilments
 * carry no carrier events or delivery confirmation, so a fulfilment older
 * than the threshold is flagged while the order is not cancelled.
 */
function trackingStaleness(order, tracking, originCountry, now) {
  const destinationCountry =
    order.shippingInfo?.logistics?.shippingDestination?.address?.country ?? null;
  const results =
    order.status === "CANCELED"
      ? []
      : tracking
          .filter((t) => t.createdDate)
          .map((t) =>
            staleTracking({ shippedAt: t.createdDate, originCountry, destinationCountry, now }),
          );
  return (
    stalestShipment(results) ||
    staleTracking({ shippedAt: null, originCountry, destinationCountry, now })
  );
}

/**
 * Merge order + transactions + fulfilments and derive the support summary.
 * Projects the fields a support conversation needs (the raw Wix order carries
 * channel, attribution, tax and activity data the agent must not see).
 * `transactions` / `fulfillments` may be null when a secondary read failed —
 * the summary then degrades (flags still computed from the order itself).
 */
function enrichOrder(
  order,
  transactions,
  fulfillments,
  { originCountry = null, now = Date.now() } = {},
) {
  const payments = transactions ? paymentBalances(transactions) : [];
  const paidFromTx = round2(payments.reduce((s, p) => s + p.paid, 0));
  const refundedFromTx = round2(payments.reduce((s, p) => s + p.refunded, 0));
  // balanceSummary is authoritative when present; transactions are the fallback.
  const fromBalance = balanceRemaining(order);
  const remainingRefundable =
    fromBalance !== null ? fromBalance : round2(Math.max(0, paidFromTx - refundedFromTx));

  const notCanceled = order.status !== "CANCELED";
  const unfulfilled = (order.fulfillmentStatus || "NOT_FULFILLED") === "NOT_FULFILLED";
  const tracking = trackingSummary(fulfillments);
  const destination = order.shippingInfo?.logistics?.shippingDestination ?? null;

  return {
    id: order.id,
    number: order.number,
    createdDate: order.createdDate ?? null,
    updatedDate: order.updatedDate ?? null,
    status: order.status,
    paymentStatus: order.paymentStatus ?? null,
    fulfillmentStatus: order.fulfillmentStatus ?? null,
    currency: order.currency ?? null,
    buyer: {
      email: order.buyerInfo?.email ?? null,
      contactId: order.buyerInfo?.contactId ?? null,
      memberId: order.buyerInfo?.memberId ?? null,
      ...(contactOf(order.billingInfo?.contactDetails) || {}),
    },
    buyerNote: order.buyerNote ?? null,
    totals: {
      subtotal: order.priceSummary?.subtotal ?? null,
      shipping: order.priceSummary?.shipping ?? null,
      tax: order.priceSummary?.tax ?? null,
      discount: order.priceSummary?.discount ?? null,
      total: order.priceSummary?.total ?? null,
      paid: order.balanceSummary?.paid ?? null,
      refunded: order.balanceSummary?.refunded ?? null,
    },
    shippingMethod: order.shippingInfo?.title ?? null,
    shippingAddress: destination
      ? { address: destination.address ?? null, contact: contactOf(destination.contactDetails) }
      : null,
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
      isRefundable: remainingRefundable > 0,
      remainingRefundable: {
        amount: remainingRefundable.toFixed(2),
        currency: order.currency ?? null,
      },
      addressChangeable: notCanceled && unfulfilled,
      deliveredAt: null, // Wix does not expose delivery confirmation on fulfilments.
      shippedAt: tracking.length ? tracking[0].createdDate : null,
      tracking: trackingStaleness(order, tracking, originCountry, now),
    },
  };
}

/** Read the three endpoints a support flow needs; secondary reads degrade to null. */
async function loadEnrichedOrder(order) {
  const [transactions, fulfillments, originCountry] = await Promise.all([
    getTransactions(order.id).catch((err) => {
      console.error(`[wix] transactions read failed for ${order.id}: ${err.message}`);
      return null;
    }),
    getFulfillments(order.id).catch((err) => {
      console.error(`[wix] fulfillments read failed for ${order.id}: ${err.message}`);
      return null;
    }),
    getStoreCountry(),
  ]);
  return enrichOrder(order, transactions, fulfillments, { originCountry });
}

module.exports = {
  summarizeOrder,
  searchOrders,
  searchOrdersByEmail,
  getOrderById,
  resolveOrder,
  getTransactions,
  getFulfillments,
  trackingSummary,
  paymentBalances,
  balanceRemaining,
  enrichOrder,
  loadEnrichedOrder,
};
