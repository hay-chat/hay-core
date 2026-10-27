// lib/format.js — response envelopes + Nuvemshop-shape helpers shared by tools.
//
// Nuvemshop i18n fields (product name/description/handle, attribute names,
// variant values, category names) are objects keyed by language code
// ({"es": …, "pt": …, "en": …}) even on single-language stores. The slim*
// helpers flatten them to one language so the agent doesn't burn tokens on
// duplicate translations.

const { MAIN_LANGUAGE } = require("./client");

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }] };
}

function fail(err) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Pick one language from an i18n object field (string fields pass through). */
function pickLang(field, lang) {
  if (field === null || field === undefined) return undefined;
  if (typeof field === "string") return field;
  const candidates = [lang, MAIN_LANGUAGE, "pt", "es", "en", ...Object.keys(field)];
  for (const key of candidates) {
    if (typeof field[key] === "string" && field[key].length > 0) return field[key];
  }
  return undefined;
}

/** Total stock for a variant; `undefined` means untracked/unlimited. */
function variantStock(variant) {
  if (variant.stock !== undefined && variant.stock !== null) return variant.stock;
  if (Array.isArray(variant.inventory_levels) && variant.inventory_levels.length > 0) {
    let total = 0;
    for (const level of variant.inventory_levels) {
      if (level.stock === null) return undefined;
      total += level.stock;
    }
    return total;
  }
  return undefined;
}

/** Compact variant: one language, effective price, resolved stock. */
function slimVariant(variant, lang) {
  const stock = variantStock(variant);
  return {
    id: variant.id,
    sku: variant.sku || undefined,
    values: (variant.values ?? []).map((value) => pickLang(value, lang)).filter(Boolean),
    price: variant.price,
    promotional_price: variant.promotional_price || undefined,
    stock_management: variant.stock_management,
    stock: stock === undefined ? "unlimited" : stock,
  };
}

/** Compact product: one language, slim variants, image URLs, category names. */
function slimProduct(product, lang) {
  return {
    id: product.id,
    name: pickLang(product.name, lang),
    description: pickLang(product.description, lang),
    handle: pickLang(product.handle, lang),
    published: product.published,
    brand: product.brand || undefined,
    tags: product.tags || undefined,
    canonical_url: product.canonical_url || undefined,
    attributes: (product.attributes ?? []).map((attr) => pickLang(attr, lang)).filter(Boolean),
    categories: (product.categories ?? []).map((category) =>
      typeof category === "object"
        ? { id: category.id, name: pickLang(category.name, lang) }
        : { id: category },
    ),
    images: (product.images ?? []).slice(0, 10).map((img) => img.src),
    variants: (product.variants ?? []).map((variant) => slimVariant(variant, lang)),
    created_at: product.created_at,
    updated_at: product.updated_at,
  };
}

/** Compact order line item. */
function slimLineItem(item) {
  return {
    product_id: item.product_id,
    variant_id: item.variant_id,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    sku: item.sku || undefined,
  };
}

const CANCELLED = "cancelled";
const SHIPPED_STATUSES = new Set(["fulfilled", "shipped", "delivered", "partially_fulfilled"]);

/**
 * Support summary for an order — mirrors the Shopify plugin's enrichOrder():
 * one read answers "can we cancel / has it been refunded / who has the money".
 * Refund honesty: the Nuvemshop merchant API cannot move money, so the summary
 * always names where the money movement actually happens (see orders.js).
 */
function orderSupportSummary(order) {
  const shipped = SHIPPED_STATUSES.has(order.shipping_status);
  return {
    isCancellable: order.status === "open" && !shipped,
    isShipped: shipped,
    paymentStatus: order.payment_status,
    refundState:
      order.payment_status === "refunded"
        ? "fully_refunded"
        : order.payment_status === "partially_refunded"
          ? "partially_refunded"
          : order.payment_status === "voided"
            ? "voided"
            : "not_refunded",
    paymentProvider: order.gateway_name || order.gateway || "unknown",
  };
}

/** Compact order: the fields a support flow actually reads, plus the summary. */
function slimOrder(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    payment_status: order.payment_status,
    shipping_status: order.shipping_status,
    currency: order.currency,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    gateway: order.gateway,
    gateway_name: order.gateway_name,
    payment_details: order.payment_details,
    cancel_reason: order.cancel_reason || undefined,
    cancelled_at: order.cancelled_at || undefined,
    paid_at: order.paid_at || undefined,
    created_at: order.created_at,
    updated_at: order.updated_at,
    contact_email: order.contact_email,
    customer: order.customer
      ? { id: order.customer.id, name: order.customer.name, email: order.customer.email }
      : undefined,
    products: (order.products ?? []).map(slimLineItem),
    shipping_address: order.shipping_address,
    shipping_option: order.shipping_option,
    shipping_tracking_number: order.shipping_tracking_number || undefined,
    shipping_tracking_url: order.shipping_tracking_url || undefined,
    note: order.note || undefined,
    owner_note: order.owner_note || undefined,
    supportSummary: orderSupportSummary(order),
  };
}

module.exports = {
  ok,
  fail,
  pickLang,
  variantStock,
  slimVariant,
  slimProduct,
  slimOrder,
  orderSupportSummary,
  CANCELLED,
  SHIPPED_STATUSES,
};
