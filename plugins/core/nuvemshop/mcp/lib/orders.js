/**
 * Shared order helpers: resolve an order by id or number, read tracking from
 * the order's fulfillment orders (2025-03) and the legacy order fields, read
 * payment transactions when the token may, and derive the support summary.
 *
 * Nuvemshop REST 2025-03:
 *   GET /orders/{id}                        GET /orders?q=…&status=any
 *   GET /orders/{id}/fulfillment-orders     (tracking_info, destination, status)
 *   GET /orders/{id}/transactions           (documented "for payment apps"; read
 *                                            best-effort, never required)
 *
 * Refund honesty: the merchant API has no endpoint that moves money. Refunds
 * are executed by the payment provider (Nuvem Pago: admin → order → "Estornar
 * pagamento"; Mercado Pago and others: their own panel). Nothing here may
 * claim otherwise.
 */

const { nsApi, nsList, NuvemshopApiError } = require("./client");
const { num, round2 } = require("./format");

/** Fulfillment-order statuses under which nothing has left the warehouse. */
const PRE_DISPATCH_FO = new Set(["UNPACKED", "IN_PREPARATION", "PACKED"]);
/** Order-level shipping_status values that mean at least part has shipped. */
const SHIPPED_ORDER_STATUSES = new Set([
  "shipped",
  "fulfilled",
  "delivered",
  "partially_fulfilled",
]);

const HOW_TO_REFUND =
  "The Nuvemshop API cannot move money. The merchant refunds from the payment provider: " +
  "Nuvem Pago → store admin → the order → 'Estornar pagamento'; Mercado Pago, PagBank and " +
  "other gateways → that provider's own panel. Once the provider processes it, the order's " +
  "payment_status becomes 'refunded' or 'partially_refunded' here.";

function orderNotFound(ref) {
  return new Error(
    `Order ${ref} not found. The internal order id differs from the number the customer ` +
      "sees: pass the customer's number as order_number, or find their orders with " +
      "nuvemshop_list_customer_orders (email).",
  );
}

async function getOrderById(orderId) {
  try {
    return await nsApi("GET", `/orders/${encodeURIComponent(orderId)}`);
  } catch (err) {
    if (err instanceof NuvemshopApiError && err.status === 404) throw orderNotFound(orderId);
    throw err;
  }
}

/**
 * Resolve one order from `{ order_id, order_number }`. The list endpoint's `q`
 * is a contains-match over order numbers AND customer names/emails, so #101
 * also surfaces #1010 and joao101@…; every hit is verified and pages are
 * exhausted (status=any, so cancelled/closed orders are findable) before
 * reporting not-found.
 */
async function resolveOrder({ order_id: orderId, order_number: orderNumber }) {
  if (orderId && orderNumber) throw new Error("Pass either order_id or order_number, not both.");
  if (orderId) return getOrderById(orderId);
  if (!orderNumber) throw new Error("Pass order_id or order_number.");

  const wanted = String(orderNumber).replace(/^#/, "").trim();
  if (!/^\d+$/.test(wanted)) {
    throw new Error(`"${orderNumber}" is not a Nuvemshop order number (digits only, e.g. 1042).`);
  }
  const perPage = 50;
  for (let page = 1; page <= 10; page++) {
    const { items, total } = await nsList("/orders", {
      q: wanted,
      status: "any",
      per_page: perPage,
      page,
    });
    const match = items.find((o) => String(o.number) === wanted);
    if (match) return match;
    if (items.length < perPage || (total !== null && page * perPage >= total)) break;
  }
  throw new Error(
    `No order with number #${wanted}. Ask the customer to check the number on their ` +
      "confirmation email, or look them up by email with nuvemshop_find_customer.",
  );
}

function carrierName(shipping) {
  const c = shipping?.carrier;
  if (!c) return null;
  if (typeof c === "string") return c;
  return c.name || c.code || null;
}

/** One fulfillment order → tracking row. */
function normalizeFulfillment(fo) {
  const events = (fo.tracking_events || [])
    .slice()
    .sort((a, b) => String(b.happened_at).localeCompare(String(a.happened_at)));
  const delivered = events.find((e) => e.status === "delivered");
  const dispatched = events.filter((e) => e.status === "dispatched").pop();
  return {
    fulfillmentOrderId: fo.id ?? null,
    status: fo.status ?? null,
    trackingNumber: fo.tracking_info?.code || null,
    trackingUrl: fo.tracking_info?.url || null,
    carrier: carrierName(fo.shipping),
    shippingOption: fo.shipping?.option?.name || fo.shipping?.option || null,
    shippingType: fo.shipping?.type ?? null,
    estimatedDelivery:
      fo.shipping?.min_delivery_date || fo.shipping?.max_delivery_date
        ? { from: fo.shipping.min_delivery_date ?? null, to: fo.shipping.max_delivery_date ?? null }
        : null,
    latestEvent: events[0]
      ? {
          status: events[0].status,
          description: events[0].description ?? null,
          happenedAt: events[0].happened_at ?? null,
          estimatedDeliveryAt: events[0].estimated_delivery_at ?? null,
        }
      : null,
    dispatchedAt: dispatched?.happened_at || null,
    deliveredAt:
      delivered?.happened_at || (fo.status === "DELIVERED" ? fo.fulfilled_at || null : null),
    labels: (fo.labels || []).length,
  };
}

/**
 * Tracking lookup: the order's fulfillment orders (endpoint, then the partial
 * `fulfillments` array on the order) plus the legacy order-level
 * shipping_tracking_number / _url. Never throws; [] means nothing recorded.
 */
async function getFulfillments(order) {
  let fos = null;
  try {
    const data = await nsApi("GET", `/orders/${order.id}/fulfillment-orders`);
    if (Array.isArray(data)) fos = data;
  } catch (err) {
    // 404/403 = API version or token scope without fulfillment orders.
    if (!(err instanceof NuvemshopApiError && [401, 403, 404].includes(err.status))) {
      console.error(`[nuvemshop] fulfillment-orders lookup failed: ${err.message}`);
    }
  }
  if (!fos) fos = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  const rows = fos.map(normalizeFulfillment);

  const legacyNumber = order.shipping_tracking_number || null;
  if (legacyNumber && !rows.some((r) => r.trackingNumber === legacyNumber)) {
    rows.push({
      fulfillmentOrderId: null,
      status: null,
      trackingNumber: legacyNumber,
      trackingUrl: order.shipping_tracking_url || null,
      carrier: null,
      shippingOption: order.shipping_option || null,
      shippingType: null,
      estimatedDelivery: null,
      latestEvent: null,
      dispatchedAt: null,
      deliveredAt: null,
      labels: 0,
    });
  }
  return { rows, raw: fos };
}

/**
 * Payment transactions. Documented as "for the exclusive use of payment apps",
 * so a merchant token may be refused; any failure returns null and callers
 * fall back to the order's own payment fields.
 */
async function getTransactions(order) {
  try {
    const data = await nsApi("GET", `/orders/${order.id}/transactions`);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function transactionRefunded(transactions) {
  if (!transactions) return null;
  return round2(
    transactions.reduce((s, t) => s + num(t.refunded_amount?.value ?? t.refunded_amount), 0),
  );
}

/**
 * Nothing has left the warehouse: order open, order shipping_status not
 * shipped, every fulfillment order still pre-dispatch with no tracking code or
 * shipping label, and no legacy tracking number. Status alone lies — a label
 * or tracking code means the parcel is (about to be) with the carrier.
 */
function dispatchState(order, tracking) {
  if (order.status !== "open") return { preDispatch: false, reason: `order is ${order.status}` };
  if (SHIPPED_ORDER_STATUSES.has(order.shipping_status)) {
    return { preDispatch: false, reason: `shipping_status is ${order.shipping_status}` };
  }
  for (const row of tracking) {
    if (row.trackingNumber) {
      return { preDispatch: false, reason: `tracking ${row.trackingNumber} is recorded` };
    }
    if (row.status && !PRE_DISPATCH_FO.has(row.status)) {
      return { preDispatch: false, reason: `fulfillment status is ${row.status}` };
    }
    if (row.labels > 0) return { preDispatch: false, reason: "a shipping label was created" };
  }
  return { preDispatch: true, reason: null };
}

function refundState(paymentStatus) {
  if (paymentStatus === "refunded") return "fully_refunded";
  if (paymentStatus === "partially_refunded") return "partially_refunded";
  if (paymentStatus === "voided") return "voided";
  return "not_refunded";
}

const PAID_STATUSES = new Set(["paid", "partially_paid", "partially_refunded", "refunded"]);

/** Payment projection: method, Pix state, gateway. */
function paymentInfo(order) {
  const method = order.payment_details?.method || null;
  const isPix = method === "pix";
  const status = order.payment_status || null;
  let pixStatus = null;
  if (isPix) {
    pixStatus =
      {
        pending: "awaiting_payment",
        paid: "paid",
        abandoned: "expired_or_abandoned",
        voided: "voided",
        refunded: "refunded",
        partially_refunded: "partially_refunded",
        partially_paid: "partially_paid",
      }[status] || status;
  }
  return {
    status,
    method,
    isPix,
    pixStatus,
    cardBrand: order.payment_details?.credit_card_company || null,
    installments: order.payment_details?.installments ?? null,
    gateway: order.gateway || null,
    gatewayName: order.gateway_name || null,
    paidAt: order.paid_at || null,
    awaitingPayment:
      (status === "pending" || status === "partially_paid") && order.status !== "cancelled",
  };
}

function lineItems(order) {
  return (order.products || []).map((li) => ({
    id: li.id,
    productId: li.product_id,
    variantId: li.variant_id,
    name: li.name,
    sku: li.sku || null,
    quantity: Number(li.quantity),
    price: li.price,
  }));
}

function summarizeOrder(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.payment_status,
    shippingStatus: order.shipping_status,
    createdAt: order.created_at,
    total: order.total,
    currency: order.currency,
    email: order.contact_email || order.customer?.email || null,
  };
}

function enrichOrder(order, tracking, transactions) {
  const { preDispatch } = dispatchState(order, tracking);
  const payment = paymentInfo(order);
  const total = num(order.total);
  const refunded = transactionRefunded(transactions);
  const paid = PAID_STATUSES.has(order.payment_status);
  const remaining =
    order.payment_status === "refunded"
      ? 0
      : refunded !== null
        ? round2(Math.max(0, total - refunded))
        : order.payment_status === "partially_refunded"
          ? null // unknown: the order does not say how much was returned
          : total;
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    shippingStatus: order.shipping_status,
    currency: order.currency,
    createdAt: order.created_at,
    cancelledAt: order.cancelled_at || null,
    cancelReason: order.cancel_reason || null,
    contact: {
      name: order.contact_name || order.customer?.name || null,
      email: order.contact_email || order.customer?.email || null,
      phone: order.contact_phone || order.customer?.phone || null,
    },
    customerId: order.customer?.id ?? null,
    customerNote: order.note || null,
    ownerNote: order.owner_note || null,
    payment,
    totals: {
      subtotal: order.subtotal,
      discount: order.discount,
      shipping: order.shipping_cost_customer ?? null,
      total: order.total,
      refunded: refunded === null ? null : refunded.toFixed(2),
    },
    coupons: (order.coupon || []).map((c) => c.code).filter(Boolean),
    shippingAddress: order.shipping_address
      ? {
          name: order.shipping_address.name ?? null,
          address: order.shipping_address.address ?? null,
          number: order.shipping_address.number ?? null,
          floor: order.shipping_address.floor ?? null,
          locality: order.shipping_address.locality ?? null,
          city: order.shipping_address.city ?? null,
          province: order.shipping_address.province ?? null,
          zipcode: order.shipping_address.zipcode ?? null,
          country: order.shipping_address.country ?? null,
          phone: order.shipping_address.phone ?? null,
        }
      : null,
    shippingOption: order.shipping_option || null,
    lineItems: lineItems(order),
    tracking,
    supportSummary: {
      isCancellable: order.status !== "cancelled" && preDispatch,
      addressChangeable: preDispatch,
      isPaid: paid,
      refundState: refundState(order.payment_status),
      remainingRefundable:
        remaining === null ? null : { amount: remaining.toFixed(2), currency: order.currency },
      // Never true: no Nuvemshop endpoint returns money. See nuvemshop_request_refund.
      refundCanBeExecutedByAgent: false,
      awaitingPayment: payment.awaitingPayment,
      shippedAt: tracking.find((t) => t.dispatchedAt)?.dispatchedAt ?? null,
      deliveredAt: tracking.find((t) => t.deliveredAt)?.deliveredAt ?? null,
    },
  };
}

module.exports = {
  HOW_TO_REFUND,
  PRE_DISPATCH_FO,
  orderNotFound,
  getOrderById,
  resolveOrder,
  getFulfillments,
  getTransactions,
  transactionRefunded,
  normalizeFulfillment,
  dispatchState,
  paymentInfo,
  refundState,
  summarizeOrder,
  enrichOrder,
  PAID_STATUSES,
};
