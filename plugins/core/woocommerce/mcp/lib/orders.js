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
const { num, round2 } = require("./format");

/** Statuses under which nothing has left the warehouse yet. */
const PRE_DISPATCH_STATUSES = new Set(["pending", "on-hold", "processing"]);

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
      throw new Error(
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
  if (orderId && orderNumber) throw new Error("Pass either order_id or order_number, not both.");
  if (orderId) return getOrderById(orderId);
  if (!orderNumber) throw new Error("Pass order_id or order_number.");

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
    throw new Error(
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

function enrichOrder(order, tracking) {
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
    totals: {
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
    refunds: (order.refunds || []).map((r) => ({ id: r.id, reason: r.reason, total: r.total })),
    tracking: rows,
    supportSummary: {
      isCancellable: preDispatch,
      // Refundability is about money, not status: a paid order that was
      // cancelled still owes the customer a refund.
      isRefundable: paid && remaining > 0,
      remainingRefundable: { amount: remaining.toFixed(2), currency: order.currency },
      addressChangeable: preDispatch,
      shippedAt: rows.find((r) => r.shippedAt)?.shippedAt ?? order.date_completed ?? null,
      deliveredAt: null, // WooCommerce has no delivery confirmation.
    },
  };
}

module.exports = {
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
};
