/**
 * Shared order helpers: resolve an order by entity id or increment id (the
 * number the customer sees), read shipments (tracking) and invoices, and
 * derive the support summary.
 *
 * Magento 2 REST:
 *   GET /orders/{entityId}            GET /orders?searchCriteria…(increment_id)
 *   GET /shipments?searchCriteria…(order_id)   → items[].tracks[]
 *   GET /invoices?searchCriteria…(order_id)    → needed for online refunds
 */

const { staleTracking, stalestShipment } = require("@hay/plugin-sdk/stale-tracking");
const { magentoApi, searchCriteria, MagentoApiError } = require("./client");
const { num, round2 } = require("./format");

/**
 * Order states Magento's own Order::canCancel() accepts. `holded` must be
 * released and `payment_review` must settle (merchant actions) before a
 * cancel is possible.
 */
const CANCELLABLE_STATES = new Set(["new", "pending_payment"]);
const CLOSED_STATES = new Set(["canceled", "closed", "complete"]);

function summarizeOrder(order) {
  return {
    id: order.entity_id,
    number: order.increment_id,
    status: order.status,
    state: order.state,
    createdAt: order.created_at,
    total: order.grand_total,
    currency: order.order_currency_code,
    email: order.customer_email ?? null,
  };
}

async function getOrderById(orderId) {
  try {
    return await magentoApi("GET", `/orders/${encodeURIComponent(orderId)}`);
  } catch (err) {
    if (err instanceof MagentoApiError && err.status === 404) {
      throw new Error(
        `Order ${orderId} not found. Pass the order number the customer sees as order_number, or ` +
          "find it in the recentOrders of magento_find_customer.",
      );
    }
    throw err;
  }
}

/** Resolve one order from `{ order_id, order_number }` (increment_id). */
async function resolveOrder({ order_id: orderId, order_number: orderNumber }) {
  if (orderId && orderNumber) throw new Error("Pass either order_id or order_number, not both.");
  if (orderId) return getOrderById(orderId);
  if (!orderNumber) throw new Error("Pass order_id or order_number.");
  const wanted = String(orderNumber).replace(/^#/, "").trim();
  const res = await magentoApi("GET", "/orders", {
    query: searchCriteria([{ field: "increment_id", value: wanted }], { pageSize: 1 }),
  });
  const order = res?.items?.[0];
  if (!order) {
    throw new Error(
      `No order with number ${wanted}. Ask the customer to check the number on their confirmation ` +
        "email, or look them up by email with magento_find_customer.",
    );
  }
  return order;
}

async function listOrdersByEmail(email, { pageSize = 10, currentPage = 1 } = {}) {
  const res = await magentoApi("GET", "/orders", {
    query: searchCriteria([{ field: "customer_email", value: email }], {
      pageSize,
      currentPage,
      sortField: "created_at",
    }),
  });
  return { items: res?.items ?? [], total: res?.total_count ?? 0 };
}

async function getShipments(orderId) {
  const res = await magentoApi("GET", "/shipments", {
    query: searchCriteria([{ field: "order_id", value: orderId }], { pageSize: 50 }),
  });
  return res?.items ?? [];
}

async function getInvoices(orderId) {
  const res = await magentoApi("GET", "/invoices", {
    query: searchCriteria([{ field: "order_id", value: orderId }], { pageSize: 50 }),
  });
  return res?.items ?? [];
}

function trackingSummary(shipments) {
  const rows = [];
  for (const s of shipments || []) {
    const tracks = s.tracks || [];
    if (!tracks.length) {
      rows.push({
        shipmentId: s.entity_id,
        shipmentNumber: s.increment_id,
        shippedAt: s.created_at,
        trackingNumber: null,
        carrier: null,
        title: null,
      });
    }
    for (const t of tracks) {
      rows.push({
        shipmentId: s.entity_id,
        shipmentNumber: s.increment_id,
        shippedAt: s.created_at,
        trackingNumber: t.track_number ?? null,
        carrier: t.carrier_code ?? null,
        title: t.title ?? null,
      });
    }
  }
  return rows;
}

function shippingAddressOf(order) {
  return order?.extension_attributes?.shipping_assignments?.[0]?.shipping?.address ?? null;
}

/** Magento REST dates are UTC without a zone ("2026-10-20 10:00:00"). */
function utcIso(value) {
  if (!value) return null;
  const text = String(value).trim().replace(" ", "T");
  return /Z|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`;
}

/**
 * D6-9 stale flag: days since each shipment was created. Magento has no
 * carrier events or delivery confirmation, so a shipment that left more than
 * the threshold ago is flagged until the order is closed or cancelled. The
 * store country is not readable over REST, so the origin is unknown and the
 * shorter domestic threshold applies unless the store sets its own.
 */
function trackingStaleness(order, shipments, now) {
  const destinationCountry = shippingAddressOf(order)?.country_id ?? null;
  const open = order.state !== "canceled" && order.state !== "closed";
  const results = open
    ? (shipments || [])
        .filter((s) => s.created_at)
        .map((s) =>
          staleTracking({ shippedAt: utcIso(s.created_at), destinationCountry, now }),
        )
    : [];
  return stalestShipment(results) || staleTracking({ shippedAt: null, destinationCountry, now });
}

function enrichOrder(order, shipments, invoices, { now = Date.now() } = {}) {
  const paid = num(order.total_paid);
  const refunded = num(order.total_refunded);
  const remaining = round2(Math.max(0, paid - refunded));
  const shipped =
    (shipments || []).length > 0 ||
    (num(order.total_qty_ordered) > 0 && (order.items || []).some((i) => num(i.qty_shipped) > 0));
  const closed = CLOSED_STATES.has(order.state);
  const tracking = trackingSummary(shipments);

  return {
    id: order.entity_id,
    number: order.increment_id,
    status: order.status,
    state: order.state,
    createdAt: order.created_at,
    currency: order.order_currency_code,
    customer: {
      id: order.customer_id ?? null,
      isGuest: Boolean(order.customer_is_guest),
      email: order.customer_email ?? null,
      firstName: order.customer_firstname ?? null,
      lastName: order.customer_lastname ?? null,
    },
    paymentMethod: order.payment?.method ?? null,
    totals: {
      subtotal: order.subtotal,
      shipping: order.shipping_amount,
      tax: order.tax_amount,
      discount: order.discount_amount,
      total: order.grand_total,
      paid: order.total_paid ?? "0",
      refunded: order.total_refunded ?? "0",
    },
    shippingAddress: shippingAddressOf(order),
    shippingMethod: order.shipping_description ?? null,
    lineItems: (order.items || [])
      .filter((i) => !i.parent_item_id) // configurable children duplicate the parent row
      .map((i) => ({
        id: i.item_id,
        sku: i.sku,
        name: i.name,
        productId: i.product_id,
        quantityOrdered: i.qty_ordered,
        quantityShipped: i.qty_shipped ?? 0,
        quantityRefunded: i.qty_refunded ?? 0,
        price: i.price,
        rowTotal: i.row_total,
      })),
    invoices: (invoices || []).map((inv) => ({
      id: inv.entity_id,
      number: inv.increment_id,
      state: inv.state,
      total: inv.grand_total,
    })),
    tracking,
    supportSummary: {
      isCancellable: !closed && !shipped && CANCELLABLE_STATES.has(order.state),
      isRefundable: remaining > 0 && order.state !== "canceled",
      remainingRefundable: { amount: remaining.toFixed(2), currency: order.order_currency_code },
      addressChangeable: !closed && !shipped,
      shippedAt: tracking[0]?.shippedAt ?? null,
      deliveredAt: null, // Magento has no delivery confirmation.
      tracking: trackingStaleness(order, shipments, now),
      needsCreditMemo: paid > 0, // paid orders cannot be cancelled; refund instead
    },
  };
}

module.exports = {
  CANCELLABLE_STATES,
  CLOSED_STATES,
  summarizeOrder,
  getOrderById,
  resolveOrder,
  listOrdersByEmail,
  getShipments,
  getInvoices,
  trackingSummary,
  shippingAddressOf,
  enrichOrder,
};
