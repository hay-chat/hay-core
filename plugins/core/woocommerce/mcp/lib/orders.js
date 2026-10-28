/**
 * Shared order helpers: resolve an order by id or number, read tracking from
 * whichever shipment-tracking plugin the store runs, and derive the support
 * summary (isCancellable, isRefundable, remainingRefundable, addressChangeable).
 *
 * WooCommerce REST v3:
 *   GET /orders/{id}                         GET /orders?search=…
 *   GET /orders/{id}/shipment-trackings      (official Shipment Tracking plugin, namespace wc/v3)
 *   GET /wc-ast/v3/orders/{id}/shipment-trackings (Advanced Shipment Tracking)
 */

const { wcApi, wcList, WooApiError } = require("./client");
const { num, round2, toolError } = require("./format");
const { parsePix } = require("./pix");
const { staleTracking, stalestShipment } = require("@hay/plugin-sdk/stale-tracking");
const { readReturnInstructions } = require("@hay/plugin-sdk/return-instructions");
const { orderNotFoundError } = require("@hay/plugin-sdk/marketplace-orders");

/** Statuses under which nothing has left the warehouse yet. */
const PRE_DISPATCH_STATUSES = new Set(["pending", "on-hold", "processing"]);
/** Core offline payment methods: WooCommerce cannot send money back through them. */
const OFFLINE_PAYMENT_METHODS = new Set(["bacs", "cod", "cheque"]);

function summarizeOrder(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    dateCreated: order.date_created,
    total: order.total,
    currency: order.currency,
    paymentMethod: order.payment_method_title ?? null,
    email: order.billing?.email ?? null,
  };
}

async function getOrderById(orderId) {
  try {
    return await wcApi("GET", `/orders/${encodeURIComponent(orderId)}`);
  } catch (err) {
    if (err instanceof WooApiError && err.status === 404) {
      throw orderNotFoundError(
        orderId,
        `Order ${orderId} not found. Find the order via woocommerce_find_customer (email) and use ` +
          "the id from recentOrders, or pass the number the customer sees as order_number.",
      );
    }
    throw err;
  }
}

/**
 * Resolve one order from `{ order_id, order_number }`. In stock WooCommerce the
 * number equals the id, but sequential-number plugins break that, so the
 * number path verifies the match and falls back to a search.
 */
async function resolveOrder({ order_id: orderId, order_number: orderNumber }) {
  if (orderId && orderNumber) {
    throw toolError("BAD_INPUT", "Pass either order_id or order_number, not both.");
  }
  if (orderId) return getOrderById(orderId);
  if (!orderNumber) throw toolError("BAD_INPUT", "Pass order_id or order_number.");

  const wanted = String(orderNumber).replace(/^#/, "").trim();
  if (/^\d+$/.test(wanted)) {
    try {
      const direct = await wcApi("GET", `/orders/${wanted}`);
      if (direct && String(direct.number) === wanted) return direct;
    } catch (err) {
      if (!(err instanceof WooApiError && err.status === 404)) throw err;
    }
  }
  const { items } = await wcList("/orders", { search: wanted, per_page: 10 });
  const match = items.find((o) => String(o.number) === wanted);
  if (!match) {
    throw orderNotFoundError(
      wanted,
      `No order with number ${wanted}. Ask the customer to check the number on their confirmation ` +
        "email, or look them up by email with woocommerce_find_customer.",
    );
  }
  return match;
}

/** Normalise one tracking record from any of the plugin shapes. */
function normalizeTrackingItem(item) {
  if (!item || typeof item !== "object") return null;
  const number =
    item.tracking_number ?? item.trackingNumber ?? item.number ?? item.tracking_code ?? null;
  if (!number) return null;
  return {
    trackingNumber: String(number),
    carrier:
      item.custom_tracking_provider ||
      item.tracking_provider ||
      item.provider ||
      item.carrier ||
      item.tracking_provider_name ||
      null,
    trackingUrl:
      item.custom_tracking_link ||
      item.tracking_link ||
      item.formatted_tracking_link ||
      item.tracking_url ||
      item.url ||
      null,
    shippedAt: item.date_shipped
      ? /^\d+$/.test(String(item.date_shipped))
        ? new Date(Number(item.date_shipped) * 1000).toISOString()
        : String(item.date_shipped)
      : null,
    source: item.__source || "plugin",
  };
}

/** Last resort: scalar meta values whose key mentions tracking. */
function trackingFromGenericMeta(metaData) {
  const scalars = (metaData || []).filter(
    (m) =>
      /track/i.test(String(m.key)) &&
      ["string", "number"].includes(typeof m.value) &&
      m.value !== "",
  );
  if (!scalars.length) return [];
  const pick = (re) => scalars.find((m) => re.test(String(m.key)))?.value ?? null;
  const number = pick(/(number|code|id)$/i) ?? pick(/track/i);
  if (!number) return [];
  return [
    {
      trackingNumber: String(number),
      carrier: pick(/(provider|carrier|company)/i),
      trackingUrl: pick(/(link|url)/i),
      shippedAt: null,
      source: "meta",
    },
  ];
}

/**
 * Tracking lookup, multi-endpoint: official Shipment Tracking endpoint →
 * Advanced Shipment Tracking endpoint → `_wc_shipment_tracking_items` meta
 * (both plugins write it) → any `*tracking*` meta key. Never throws; an empty
 * list means "no tracking recorded yet".
 */
async function getTracking(order) {
  const endpoints = [
    { namespace: "wc/v3", path: `/orders/${order.id}/shipment-trackings` },
    { namespace: "wc-ast/v3", path: `/orders/${order.id}/shipment-trackings` },
  ];
  for (const ep of endpoints) {
    try {
      const data = await wcApi("GET", ep.path, { namespace: ep.namespace });
      if (Array.isArray(data) && data.length) {
        return data
          .map((d) => normalizeTrackingItem({ ...d, __source: ep.namespace }))
          .filter(Boolean);
      }
    } catch (err) {
      // 404 = plugin not installed (or no route); anything else is also non-fatal here.
      if (!(err instanceof WooApiError && (err.status === 404 || err.status === 401))) {
        console.error(`[woocommerce] tracking endpoint ${ep.namespace} failed: ${err.message}`);
      }
    }
  }
  const meta = order.meta_data || [];
  const stItems = meta.find((m) => m.key === "_wc_shipment_tracking_items")?.value;
  if (Array.isArray(stItems) && stItems.length) {
    return stItems.map((i) => normalizeTrackingItem({ ...i, __source: "meta" })).filter(Boolean);
  }
  return trackingFromGenericMeta(meta);
}

/** Refund records with dates; best-effort (an empty list on failure). */
async function getRefundDetails(order) {
  if (!(order.refunds || []).length) return [];
  try {
    const rows = await wcApi("GET", `/orders/${order.id}/refunds`, {
      query: { per_page: 100 },
    });
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error(`[woocommerce] refund list for order ${order.id} failed: ${err.message}`);
    return [];
  }
}

/** Total already refunded (WooCommerce stores refund totals as negative strings). */
function refundedTotal(order) {
  return round2((order.refunds || []).reduce((s, r) => s + Math.abs(num(r.total)), 0));
}

/**
 * Nothing has left the warehouse: pre-dispatch status AND no tracking recorded.
 * Many stores ship while the order is still `processing` (the tracking plugin
 * writes the number; the status flips later or never), so status alone lies.
 */
function isPreDispatch(order, tracking) {
  return PRE_DISPATCH_STATUSES.has(order.status) && !(tracking || []).length;
}

/**
 * Payment fields (D10-2). `refundDetails` is the /orders/{id}/refunds list (the
 * order body's refund stubs carry no date). The Pix block is only returned while
 * the order is unpaid: a paid order's code is spent and would mislead.
 */
function paymentFields(order) {
  const unpaid = order.needs_payment === true || (!order.date_paid && order.status === "pending");
  return {
    paymentMethodId: order.payment_method || null,
    transactionId: order.transaction_id || null,
    needsPayment: order.needs_payment ?? null,
    paymentUrl: unpaid ? order.payment_url || null : null,
    createdVia: order.created_via || null,
    pix: unpaid ? parsePix(order.meta_data) : null,
  };
}

let storeCountryPromise = null;

/** The store's base country ("BR:SP" → "BR"), cached per MCP process; null when unreadable. */
function getStoreCountry() {
  if (!storeCountryPromise) {
    storeCountryPromise = wcApi("GET", "/settings/general/woocommerce_default_country")
      .then((setting) => String(setting?.value || "").split(":")[0] || null)
      .catch(() => {
        storeCountryPromise = null; // retry on the next order read
        return null;
      });
  }
  return storeCountryPromise;
}

/**
 * D6-9: days since the tracking plugin recorded the shipment. WooCommerce has no
 * carrier events or delivery confirmation, so only shipments with a recorded
 * tracking row count; a "completed" order without tracking is not flagged (for
 * many stores completed means delivered).
 */
function trackingStaleness(order, rows, originCountry, now) {
  const results = rows
    .filter((r) => r.shippedAt)
    .map((r) =>
      staleTracking({
        shippedAt: r.shippedAt,
        originCountry,
        destinationCountry: order.shipping?.country || order.billing?.country,
        now,
      }),
    );
  return stalestShipment(results) || staleTracking({ shippedAt: null, originCountry, now });
}

function enrichOrder(
  order,
  tracking,
  { refundDetails = [], originCountry = null, now = Date.now() } = {},
) {
  const total = num(order.total);
  const refunded = refundedTotal(order);
  const remaining = round2(Math.max(0, total - refunded));
  const paid = Boolean(order.date_paid) || order.status === "completed";
  const preDispatch = isPreDispatch(order, tracking);
  const rows = tracking || [];

  return {
    id: order.id,
    number: order.number,
    status: order.status,
    currency: order.currency,
    dateCreated: order.date_created,
    datePaid: order.date_paid ?? null,
    dateCompleted: order.date_completed ?? null,
    customerId: order.customer_id || null,
    customerNote: order.customer_note || null,
    paymentMethod: order.payment_method_title ?? order.payment_method ?? null,
    ...paymentFields(order),
    // Every amount on this order is in `totals.currency` (ISO 4217); state it with
    // the amount, never assume a currency symbol.
    totals: {
      currency: order.currency,
      currencySymbol: order.currency_symbol || null,
      total: order.total,
      tax: order.total_tax,
      shipping: order.shipping_total,
      discount: order.discount_total,
      refunded: refunded.toFixed(2),
    },
    billing: order.billing ?? null,
    shippingAddress: order.shipping ?? null,
    shippingMethod:
      (order.shipping_lines || [])
        .map((l) => l.method_title)
        .filter(Boolean)
        .join(", ") || null,
    lineItems: (order.line_items || []).map((li) => ({
      id: li.id,
      name: li.name,
      sku: li.sku ?? null,
      productId: li.product_id,
      variationId: li.variation_id || null,
      quantity: li.quantity,
      total: li.total,
      totalTax: li.total_tax,
    })),
    refunds: (order.refunds || []).map((r) => ({
      id: r.id,
      reason: r.reason,
      total: r.total,
      dateCreated: refundDetails.find((d) => d.id === r.id)?.date_created ?? null,
    })),
    tracking: rows,
    supportSummary: {
      isCancellable: preDispatch,
      // Refundability is about money, not status: a paid order that was
      // cancelled still owes the customer a refund.
      isRefundable: paid && remaining > 0,
      remainingRefundable: { amount: remaining.toFixed(2), currency: order.currency },
      // false: a refund must be paid back by hand (create_refund with refund_payment=false).
      gatewayCanRefund: !OFFLINE_PAYMENT_METHODS.has(order.payment_method),
      addressChangeable: preDispatch,
      shippedAt: rows.find((r) => r.shippedAt)?.shippedAt ?? order.date_completed ?? null,
      deliveredAt: null, // WooCommerce has no delivery confirmation.
      tracking: trackingStaleness(order, rows, originCountry, now),
      // D6-13: the merchant's "How to return" text (null = hand return questions off).
      returnInstructions: readReturnInstructions(),
    },
  };
}

module.exports = {
  OFFLINE_PAYMENT_METHODS,
  PRE_DISPATCH_STATUSES,
  isPreDispatch,
  summarizeOrder,
  getOrderById,
  resolveOrder,
  getTracking,
  normalizeTrackingItem,
  trackingFromGenericMeta,
  refundedTotal,
  enrichOrder,
  getRefundDetails,
  getStoreCountry,
};
