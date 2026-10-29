/**
 * Pure fixture → Nuvemshop REST (2025-03) payload mapping. No I/O, so tests cover every state.
 * What the Hay.chat plugin reads (plugins/core/nuvemshop/mcp/lib/orders.js): status (open/closed/
 * cancelled), payment_status, shipping_status, payment_details.method ("pix" → Pix block),
 * gateway, owner_note, note, fulfillment orders (status, tracking_info, tracking_events with
 * happened_at) and the legacy shipping_tracking_number / _url.
 */
import { daysAgo, DEMO_TAG, productBySku, trackingNumber } from "../lib/data";
import type {
  Address,
  Customer,
  Localized,
  OrderFixture,
  Product,
  ProductVariant,
} from "../lib/types";

export const CURRENCY = "BRL";
/** Store languages we can fill from the catalogue (Nuvemshop "pt" = our pt-BR). */
export type StoreLanguage = "pt" | "en";

/** First line of owner_note on every seeded order: idempotency + --reset-orders. */
export const marker = (key: string) => `[hay-demo:${key}]`;
export const MARKER_RE = /\[hay-demo:([\w-]+)\]/;

const money = (n: number) => n.toFixed(2);
const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function localized(text: Localized, languages: StoreLanguage[]): Record<string, string> {
  return Object.fromEntries(
    languages.map((lang) => [lang, lang === "pt" ? text["pt-BR"] : text.en]),
  );
}

// ---------- products ----------

export function productHtml(product: Product, locale: "en" | "pt-BR"): string {
  const items = product.details[locale].map((d) => `<li>${escapeHtml(d)}</li>`).join("");
  return `<p>${escapeHtml(product.description[locale])}</p><ul>${items}</ul>`;
}

export const variantPrice = (product: Product, variant: ProductVariant) =>
  variant.price?.BRL ?? product.price.BRL;

/** Nuvemshop: `price` is the list ("de") price, `promotional_price` the selling ("por") price. */
export function variantPayload(
  product: Product,
  variant: ProductVariant,
  languages: StoreLanguage[],
): Record<string, unknown> {
  const price = variantPrice(product, variant);
  const was = product.compareAtPrice?.BRL;
  const onSale = Boolean(was && was > price);
  return {
    sku: variant.sku,
    price: money(onSale ? (was as number) : price),
    promotional_price: onSale ? money(price) : null,
    stock_management: true,
    stock: variant.stock,
    weight: (product.weightGrams / 1000).toFixed(3),
    // Option values are English in every store (catalogue rule), under each store language.
    values: variant.options.map((value) => Object.fromEntries(languages.map((l) => [l, value]))),
  };
}

export function productPayload(
  product: Product,
  categoryId: number,
  languages: StoreLanguage[],
): Record<string, unknown> {
  const description: Localized = {
    en: productHtml(product, "en"),
    "pt-BR": productHtml(product, "pt-BR"),
  };
  return {
    name: localized(product.title, languages),
    description: localized(description, languages),
    handle: localized({ en: product.handle, "pt-BR": product.handle }, languages),
    published: true,
    requires_shipping: true,
    categories: [categoryId],
    tags: [...new Set([DEMO_TAG, ...product.tags])].join(","),
    attributes: product.options.map((option) => localized(option, languages)),
    variants: product.variants.map((variant) => variantPayload(product, variant, languages)),
  };
}

export const CATEGORY_NAMES: Record<string, Localized> = {
  candles: { en: "Candles", "pt-BR": "Velas" },
  "pots-and-vases": { en: "Pots and Vases", "pt-BR": "Vasos e Cachepôs" },
  "cups-and-mugs": { en: "Cups and Mugs", "pt-BR": "Xícaras e Canecas" },
  "napkins-and-linen": { en: "Napkins and Linen", "pt-BR": "Guardanapos e Linho" },
  serving: { en: "Serving", "pt-BR": "Servir" },
};

export function categoryPayload(slug: string, languages: StoreLanguage[]): Record<string, unknown> {
  const name = CATEGORY_NAMES[slug] ?? { en: slug, "pt-BR": slug };
  return {
    name: localized(name, languages),
    handle: localized({ en: slug, "pt-BR": slug }, languages),
  };
}

// ---------- customers ----------

/** "Rua Augusta, 1500" → street + number, the way Brazilian checkouts split them. */
export function splitStreet(address1: string): { address: string; number: string } {
  const match = /^(.*?),\s*(\S+)\s*$/.exec(address1);
  return match ? { address: match[1], number: match[2] } : { address: address1, number: "S/N" };
}

export function nuvemAddress(address: Address): Record<string, string> {
  return {
    first_name: address.firstName,
    last_name: address.lastName,
    name: `${address.firstName} ${address.lastName}`,
    ...splitStreet(address.address1),
    floor: address.address2 ?? "",
    city: address.city,
    province: address.province ?? address.provinceCode ?? "",
    zipcode: address.zip,
    country: address.country,
    phone: address.phone ?? "",
  };
}

const digits = (s?: string) => (s ?? "").replace(/\D/g, "");

export function customerPayload(customer: Customer): Record<string, unknown> {
  return {
    name: `${customer.firstName} ${customer.lastName}`,
    email: customer.email,
    phone: customer.address.phone ?? "",
    identification: digits(customer.cpf),
    addresses: [nuvemAddress(customer.address)],
    send_email_invite: false,
  };
}

// ---------- orders ----------

export function trackingUrl(carrier: string, number: string): string {
  if (carrier === "Jadlog") return `https://www.jadlog.com.br/jadlog/tracking?cte=${number}`;
  return `https://rastreamento.correios.com.br/app/index.php?objeto=${number}`;
}

export const carrierFor = (fixture: OrderFixture) => fixture.carrier?.nuvemshop ?? "Correios";

/** brand.md: free over R$299; below it PAC at R$24.90 (the brand doc gives no PAC price; this is ours). */
export function shippingFields(fixture: OrderFixture, products: Product[]) {
  const carrier = carrierFor(fixture);
  const subtotal = fixture.lines.reduce((sum, line) => {
    const { product, variant } = productBySku(products, line.sku);
    return sum + variantPrice(product, variant) * line.quantity;
  }, 0);
  return {
    shipping_pickup_type: "ship",
    shipping: carrier === "Jadlog" ? "jadlog" : "correios",
    shipping_option: carrier === "Jadlog" ? "Jadlog .Package" : "Correios PAC",
    shipping_cost_customer: money(subtotal >= 299 ? 0 : 24.9),
  };
}

/** Mercado Pago for every method (brand.md: Pix, boleto, card through Mercado Pago). */
export function paymentFields(fixture: OrderFixture) {
  const method = fixture.paymentMethod?.nuvemshop ?? "card";
  const details =
    method === "pix" || method === "boleto"
      ? { method, credit_card_company: null, installments: 1 }
      : { method: "credit_card", credit_card_company: "visa", installments: 1 };
  return { gateway: "mercadopago", gateway_name: "Mercado Pago", payment_details: details };
}

export const isShipped = (f: OrderFixture) => f.fulfillmentStatus !== "unfulfilled";
export const isPaid = (f: OrderFixture) => !["pending", "voided"].includes(f.financialStatus);

/** payment_status values to try at creation, most faithful first (the API may refuse refund states). */
export function paymentStatusCandidates(fixture: OrderFixture): string[] {
  const base = isPaid(fixture) ? "paid" : "pending";
  return fixture.financialStatus === base ? [base] : [fixture.financialStatus, base];
}

export function refundDaysAgo(fixture: OrderFixture): number {
  if (fixture.deliveredDaysAgo !== undefined) return Math.max(fixture.deliveredDaysAgo - 2, 0);
  return Math.max(fixture.placedDaysAgo - 5, 0);
}

/** Refund amount (BRL) the fixture represents, for the owner note. */
export function refundAmount(fixture: OrderFixture, products: Product[]): number {
  const lines =
    fixture.financialStatus === "refunded" ? fixture.lines : (fixture.refundLines ?? []);
  return lines.reduce((sum, line) => {
    const { product, variant } = productBySku(products, line.sku);
    return sum + variantPrice(product, variant) * line.quantity;
  }, 0);
}

/**
 * Lines for owner_note (staff-only; the plugin returns it as ownerNote). The marker comes first.
 * Refunds are always written here too: the merchant API cannot move or record money, so this
 * is the only place a human (or the agent) sees when and how much was returned.
 */
export function ownerNoteLines(fixture: OrderFixture, products: Product[], now: Date): string[] {
  const lines = [`${marker(fixture.key)} Casa Aurora demo order: ${fixture.purpose}`];
  if (fixture.note && !/^customer note:/i.test(fixture.note)) lines.push(fixture.note);
  if (fixture.financialStatus === "refunded" || fixture.financialStatus === "partially_refunded") {
    const kind = fixture.financialStatus === "refunded" ? "Reembolso total" : "Reembolso parcial";
    const skus =
      fixture.financialStatus === "partially_refunded"
        ? ` (${(fixture.refundLines ?? []).map((l) => `${l.quantity}× ${l.sku}`).join(", ")}, chegou quebrado)`
        : "";
    lines.push(
      `${kind} de ${brl(refundAmount(fixture, products))}${skus} estornado via Mercado Pago em ${isoDay(daysAgo(refundDaysAgo(fixture), now))}.`,
    );
  }
  return lines;
}

export interface OrderContext {
  customer: Customer;
  products: Product[];
  variantId: (sku: string) => number;
  now: Date;
}

export function orderPayload(
  fixture: OrderFixture,
  ctx: OrderContext,
  paymentStatus: string,
): Record<string, unknown> {
  const { customer, products, now } = ctx;
  const placedAt = daysAgo(fixture.placedDaysAgo, now);
  const customerNote = /^customer note:\s*(.*)$/i.exec(fixture.note ?? "")?.[1];
  return {
    currency: CURRENCY,
    language: "pt",
    ...paymentFields(fixture),
    payment_status: paymentStatus,
    status: "open",
    shipping_status: "unpacked",
    products: fixture.lines.map((line) => {
      const { product, variant } = productBySku(products, line.sku);
      return {
        variant_id: ctx.variantId(line.sku),
        quantity: line.quantity,
        price: money(variantPrice(product, variant)),
      };
    }),
    customer: {
      name: `${customer.firstName} ${customer.lastName}`,
      email: customer.email,
      phone: customer.address.phone ?? "",
      document: digits(customer.cpf),
    },
    billing_address: nuvemAddress(customer.address),
    shipping_address: nuvemAddress(customer.address),
    ...shippingFields(fixture, products),
    // Leave stock alone (the catalogue's numbers are themselves fixtures) and email nobody.
    inventory_behaviour: "bypass",
    send_confirmation_email: false,
    send_fulfillment_email: false,
    ...(customerNote ? { note: customerNote } : {}),
    owner_note: ownerNoteLines(fixture, products, now).join("\n"),
    created_at: placedAt.toISOString(),
    ...(isPaid(fixture)
      ? { paid_at: new Date(placedAt.getTime() + 5 * 60 * 1000).toISOString() }
      : {}),
  };
}

export interface FulfilmentStep {
  method: "PATCH" | "POST";
  /** Relative to /orders/{id}/fulfillment-orders/{fo}. */
  path: string;
  body: Record<string, unknown>;
}

/**
 * Fulfillment-order writes for a shipped fixture: tracking + DISPATCHED, carrier events with
 * backdated happened_at (the plugin's stale check reads them), DELIVERED for delivered ones.
 * A stale fixture gets the dispatch event only, so the last update is 12 days old.
 */
export function fulfilmentSteps(fixture: OrderFixture, now: Date): FulfilmentStep[] {
  if (!isShipped(fixture) || fixture.shippedDaysAgo === undefined) return [];
  const carrier = carrierFor(fixture);
  const code = trackingNumber(fixture, "nuvemshop");
  const shippedAt = daysAgo(fixture.shippedDaysAgo, now);
  const steps: FulfilmentStep[] = [
    {
      method: "PATCH",
      path: "",
      body: {
        status: "DISPATCHED",
        tracking_info: { code, url: trackingUrl(carrier, code), notify_customer: false },
      },
    },
    {
      method: "POST",
      path: "/tracking-events",
      body: {
        status: "dispatched",
        description: `Objeto postado (${carrier})`,
        happened_at: shippedAt.toISOString(),
      },
    },
  ];
  if (fixture.fulfillmentStatus === "stale") return steps;
  const delivered =
    fixture.deliveredDaysAgo !== undefined ? daysAgo(fixture.deliveredDaysAgo, now) : undefined;
  const lastMove = delivered ?? now;
  const inTransitAt = new Date(
    shippedAt.getTime() + Math.min(24 * 3600e3, (lastMove.getTime() - shippedAt.getTime()) / 2),
  );
  steps.push({
    method: "POST",
    path: "/tracking-events",
    body: {
      status: "in_transit",
      description: "Objeto em trânsito",
      happened_at: inTransitAt.toISOString(),
    },
  });
  if (delivered) {
    steps.push(
      {
        method: "POST",
        path: "/tracking-events",
        body: {
          status: "delivered",
          description: "Objeto entregue ao destinatário",
          happened_at: delivered.toISOString(),
        },
      },
      { method: "PATCH", path: "", body: { status: "DELIVERED" } },
    );
  }
  return steps;
}

/** Legacy fallback when fulfillment orders are unavailable: POST /orders/{id}/fulfill. */
export function legacyFulfilPayload(fixture: OrderFixture): Record<string, unknown> {
  const code = trackingNumber(fixture, "nuvemshop");
  return {
    shipping_tracking_number: code,
    shipping_tracking_url: trackingUrl(carrierFor(fixture), code),
    notify_customer: false,
  };
}

/** Cancel body (plugin: POST /orders/{id}/cancel {reason, email, restock}). */
export function cancelPayload(fixture: OrderFixture): Record<string, unknown> {
  return {
    reason: fixture.financialStatus === "voided" ? "other" : "customer",
    email: false,
    restock: true,
  };
}

/** Order states the seed ends in: open | closed | cancelled. */
export function finalOrderStatus(fixture: OrderFixture): "open" | "closed" | "cancelled" {
  if (fixture.cancelled) return "cancelled";
  return fixture.fulfillmentStatus === "delivered" ? "closed" : "open";
}
