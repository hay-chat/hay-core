/**
 * Pure fixture → WooCommerce REST (wc/v3) payload mapping. No I/O here, so tests cover every
 * order state without a store. What the Hay.chat plugin reads (plugins/core/woocommerce/mcp/lib/orders.js):
 * status, date_paid, payment_method (bacs/cod/cheque = offline refunds), currency, refunds,
 * `_wc_shipment_tracking_items` meta, and as a last resort a tracking number in the order notes.
 */
import { createHash } from "node:crypto";
import { daysAgo, DEMO_TAG, productBySku, trackingNumber } from "../lib/data";
import type {
  Address,
  Customer,
  OrderFixture,
  OrderLine,
  Product,
  ProductVariant,
} from "../lib/types";

export const CURRENCY = "EUR";
/** Order meta that marks a seeded order (idempotency + --reset-orders). */
export const KEY_META = "_hay_demo_key";
/** Meta the official Shipment Tracking plugin writes (Advanced Shipment Tracking writes it too). */
export const TRACKING_META = "_wc_shipment_tracking_items";

const money = (n: number) => n.toFixed(2);
const kg = (grams: number) => (grams / 1000).toFixed(3);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- products ----------

export function productHtml(product: Product): string {
  const items = product.details.en.map((d) => `<li>${escapeHtml(d)}</li>`).join("");
  return `<p>${escapeHtml(product.description.en)}</p><ul>${items}</ul>`;
}

export function variantPrice(product: Product, variant: ProductVariant): number {
  return variant.price?.EUR ?? product.price.EUR;
}

/** Woo keeps the "was" price in regular_price and the selling price in sale_price. */
export function priceFields(product: Product, variant: ProductVariant) {
  const price = variantPrice(product, variant);
  const was = product.compareAtPrice?.EUR;
  return was && was > price
    ? { regular_price: money(was), sale_price: money(price) }
    : { regular_price: money(price), sale_price: "" };
}

export const isSimple = (product: Product) => product.options.length === 0;

export interface ProductRefs {
  categoryId: number;
  tagIds: number[];
  /** `{src}` (Woo sideloads the URL) or `{id}` of an uploaded wp/v2/media item. */
  images: Array<{ src?: string; id?: number; name?: string; alt?: string }>;
}

export function productPayload(product: Product, refs: ProductRefs): Record<string, unknown> {
  const base = {
    name: product.title.en,
    slug: product.handle,
    status: "publish",
    description: productHtml(product),
    short_description: product.description.en,
    categories: [{ id: refs.categoryId }],
    tags: refs.tagIds.map((id) => ({ id })),
    images: refs.images,
    weight: kg(product.weightGrams),
  };
  if (isSimple(product)) {
    const variant = product.variants[0];
    return {
      ...base,
      type: "simple",
      sku: variant.sku,
      ...priceFields(product, variant),
      manage_stock: true,
      stock_quantity: variant.stock,
    };
  }
  return {
    ...base,
    type: "variable",
    attributes: product.options.map((option, i) => ({
      name: option.en,
      position: i,
      visible: true,
      variation: true,
      options: [...new Set(product.variants.map((v) => v.options[i]))],
    })),
    default_attributes: product.options.map((option, i) => ({
      name: option.en,
      option: product.variants[0].options[i],
    })),
  };
}

export function variationPayload(
  product: Product,
  variant: ProductVariant,
): Record<string, unknown> {
  return {
    sku: variant.sku,
    ...priceFields(product, variant),
    manage_stock: true,
    stock_quantity: variant.stock,
    weight: kg(product.weightGrams),
    attributes: product.options.map((option, i) => ({
      name: option.en,
      option: variant.options[i],
    })),
  };
}

/** Tags every seeded product carries: the demo marker plus the catalogue's own tags. */
export const productTags = (product: Product) => [...new Set([DEMO_TAG, ...product.tags])];

export const categoryName = (slug: string) =>
  slug
    .split("-")
    .map((w, i) => (i === 0 || w !== "and" ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

// ---------- customers ----------

export function wooAddress(address: Address, email?: string): Record<string, string> {
  return {
    first_name: address.firstName,
    last_name: address.lastName,
    address_1: address.address1,
    address_2: address.address2 ?? "",
    city: address.city,
    state: address.provinceCode ?? "",
    postcode: address.zip,
    country: address.country,
    phone: address.phone ?? "",
    ...(email ? { email } : {}),
  };
}

export function customerPayload(customer: Customer): Record<string, unknown> {
  return {
    email: customer.email,
    first_name: customer.firstName,
    last_name: customer.lastName,
    // Random: nobody logs in as a demo shopper; set so stores without auto-generated passwords accept it.
    password: createHash("sha256")
      .update(`${customer.key}:${Math.random()}`)
      .digest("hex")
      .slice(0, 24),
    billing: wooAddress(customer.address, customer.email),
    shipping: wooAddress(customer.address),
  };
}

// ---------- orders ----------

/** Carrier → public tracking page (the number itself is fake, prefixed DEMO). */
export function trackingUrl(carrier: string, number: string): string {
  if (carrier === "DPD") return `https://tracking.dpd.de/status/en_US/parcel/${number}`;
  return `https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects=${number}`;
}

/** Unshipped orders still need a shipping line: CTT inside Portugal, DPD to the rest of the EU. */
export const carrierFor = (fixture: OrderFixture, customer: Customer) =>
  fixture.carrier?.woocommerce ?? (customer.address.country === "PT" ? "CTT" : "DPD");

export function subtotal(products: Product[], lines: OrderLine[]): number {
  return lines.reduce((sum, line) => {
    const { product, variant } = productBySku(products, line.sku);
    return sum + variantPrice(product, variant) * line.quantity;
  }, 0);
}

/** brand.md: free in Portugal over €50 (€3.90 below), €7.90 to the rest of the EU. */
export function shippingLine(fixture: OrderFixture, customer: Customer, products: Product[]) {
  const carrier = carrierFor(fixture, customer);
  const domestic = customer.address.country === "PT";
  const free = domestic && subtotal(products, fixture.lines) >= 50;
  const total = free ? 0 : domestic ? 3.9 : 7.9;
  return {
    method_id: free ? "free_shipping" : "flat_rate",
    method_title: `${carrier} ${domestic ? "Portugal" : "EU"}${free ? " (free)" : ""}`,
    total: money(total),
  };
}

export const isShipped = (f: OrderFixture) => f.fulfillmentStatus !== "unfulfilled";
export const isPaid = (f: OrderFixture) => !["pending", "voided"].includes(f.financialStatus);

/**
 * Order status at creation. Refund states are reached afterwards through the refunds endpoint
 * (a full refund flips the order to "refunded" by itself), so they start as a paid order.
 */
export function initialStatus(fixture: OrderFixture): string {
  if (fixture.financialStatus === "voided" || (fixture.cancelled && !isPaid(fixture)))
    return "cancelled";
  if (fixture.financialStatus === "pending") {
    // Bank transfer waits on-hold for the money; other unpaid methods stay pending.
    return fixture.paymentMethod?.woocommerce === "bacs" ? "on-hold" : "pending";
  }
  // Woo "completed" = done; shipped-but-not-delivered stays "processing" with tracking recorded,
  // which is how most stores run it (the plugin then treats it as dispatched, not cancellable).
  return fixture.fulfillmentStatus === "delivered" ? "completed" : "processing";
}

export function paymentFields(fixture: OrderFixture) {
  const method = fixture.paymentMethod?.woocommerce ?? "card";
  if (method === "bacs")
    return { payment_method: "bacs", payment_method_title: "Direct bank transfer" };
  return { payment_method: "stripe", payment_method_title: "Credit Card (Stripe)" };
}

export interface ShipmentDates {
  shippedAt?: Date;
  deliveredAt?: Date;
}

export function shipmentDates(fixture: OrderFixture, now: Date): ShipmentDates {
  return {
    shippedAt:
      fixture.shippedDaysAgo !== undefined ? daysAgo(fixture.shippedDaysAgo, now) : undefined,
    deliveredAt:
      fixture.deliveredDaysAgo !== undefined ? daysAgo(fixture.deliveredDaysAgo, now) : undefined,
  };
}

/** `_wc_shipment_tracking_items` value, the shape the Shipment Tracking plugin stores. */
export function trackingItems(fixture: OrderFixture, carrier: string, shippedAt: Date) {
  const number = trackingNumber(fixture, "woocommerce");
  return [
    {
      tracking_provider: "",
      custom_tracking_provider: carrier,
      custom_tracking_link: trackingUrl(carrier, number),
      tracking_number: number,
      date_shipped: String(Math.floor(shippedAt.getTime() / 1000)),
      tracking_id: createHash("md5").update(`${fixture.key}:${number}`).digest("hex"),
    },
  ];
}

export interface LineRef {
  product_id: number;
  variation_id?: number;
}

export interface OrderContext {
  customer: Customer;
  customerId: number;
  products: Product[];
  lineRef: (sku: string) => LineRef;
  now: Date;
}

/** Customer-facing text in fixture.note starts with "Customer note:"; anything else is staff. */
export function splitNote(note?: string): { customerNote: string; staffNote: string | null } {
  if (!note) return { customerNote: "", staffNote: null };
  const match = /^customer note:\s*(.*)$/i.exec(note);
  return match
    ? { customerNote: match[1], staffNote: null }
    : { customerNote: "", staffNote: note };
}

export function orderPayload(fixture: OrderFixture, ctx: OrderContext): Record<string, unknown> {
  const { customer } = ctx;
  const carrier = carrierFor(fixture, customer);
  const { shippedAt } = shipmentDates(fixture, ctx.now);
  const meta: Array<{ key: string; value: unknown }> = [{ key: KEY_META, value: fixture.key }];
  if (isShipped(fixture) && shippedAt)
    meta.push({ key: TRACKING_META, value: trackingItems(fixture, carrier, shippedAt) });
  const paid = isPaid(fixture);
  const payment = paymentFields(fixture);
  return {
    status: initialStatus(fixture),
    currency: CURRENCY,
    customer_id: ctx.customerId,
    ...payment,
    set_paid: paid,
    ...(paid && payment.payment_method === "stripe"
      ? {
          transaction_id: `pi_demo_${createHash("sha256").update(fixture.key).digest("hex").slice(0, 16)}`,
        }
      : {}),
    billing: wooAddress(customer.address, customer.email),
    shipping: wooAddress(customer.address),
    customer_note: splitNote(fixture.note).customerNote,
    line_items: fixture.lines.map((line) => ({
      ...ctx.lineRef(line.sku),
      quantity: line.quantity,
    })),
    shipping_lines: [shippingLine(fixture, customer, ctx.products)],
    meta_data: meta,
  };
}

export interface NotePlan {
  note: string;
  customer_note: boolean;
  /** When it "happened"; REST stamps notes with the current time (see backdateCommand). */
  date: Date;
}

/**
 * Order notes per state. The shipped note is phrased so the plugin's note parser
 * (trackingNumberInNote) finds the number, in case the store has no tracking plugin.
 */
export function orderNotes(
  fixture: OrderFixture,
  ctx: Pick<OrderContext, "customer" | "now">,
): NotePlan[] {
  const notes: NotePlan[] = [];
  const { shippedAt, deliveredAt } = shipmentDates(fixture, ctx.now);
  const placedAt = daysAgo(fixture.placedDaysAgo, ctx.now);
  const staff = splitNote(fixture.note).staffNote;
  if (staff) notes.push({ note: staff, customer_note: false, date: placedAt });
  if (isShipped(fixture) && shippedAt) {
    const carrier = carrierFor(fixture, ctx.customer);
    const number = trackingNumber(fixture, "woocommerce");
    notes.push({
      note: `Shipped with ${carrier} on ${isoDay(shippedAt)}. Your tracking number is ${number}: ${trackingUrl(carrier, number)}`,
      customer_note: true,
      date: shippedAt,
    });
  }
  if (fixture.fulfillmentStatus === "delivered" && deliveredAt) {
    notes.push({
      note: `Delivered on ${isoDay(deliveredAt)} (carrier confirmation).`,
      customer_note: false,
      date: deliveredAt,
    });
  }
  return notes;
}

/**
 * When the refund happened. OrderFixture has no refund date, so: two days after delivery (damage
 * report handled), else five days after the order was placed (the "refunded" fixture: 3 days ago).
 */
export function refundDaysAgo(fixture: OrderFixture): number {
  if (fixture.deliveredDaysAgo !== undefined) return Math.max(fixture.deliveredDaysAgo - 2, 0);
  return Math.max(fixture.placedDaysAgo - 5, 0);
}

interface CreatedLine {
  id: number;
  sku?: string;
  quantity: number;
  total: string;
}

/**
 * Refund body. `api_refund: false` only records the refund: no gateway is called (the demo
 * stripe orders have no real charge). Partial refunds name the line items, as a shop owner
 * refunding one broken item would.
 */
export function refundPayload(
  fixture: OrderFixture,
  order: { total: string; line_items?: CreatedLine[] },
): Record<string, unknown> | null {
  if (fixture.financialStatus === "refunded") {
    return {
      amount: order.total,
      reason: fixture.note ?? "Refunded at the customer's request.",
      api_refund: false,
      restock_items: true,
    };
  }
  if (fixture.financialStatus !== "partially_refunded") return null;
  const lines = (fixture.refundLines ?? []).map((refund) => {
    const line = (order.line_items ?? []).find((l) => l.sku === refund.sku);
    if (!line)
      throw new Error(`${fixture.key}: refund SKU ${refund.sku} is not on the created order`);
    const total = (Number(line.total) / line.quantity) * refund.quantity;
    return { id: line.id, quantity: refund.quantity, refund_total: Number(money(total)) };
  });
  return {
    amount: money(lines.reduce((s, l) => s + l.refund_total, 0)),
    reason: "Arrived damaged (customer sent a photo). Refunded the broken item.",
    api_refund: false,
    restock_items: false,
    line_items: lines,
  };
}
