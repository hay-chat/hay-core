/**
 * Shared shapes for the Casa Aurora demo data. The JSON files under catalog/ and orders/ follow
 * these types; every seed script reads them through ./data.ts so the three stores stay identical.
 */

export type Locale = "en" | "pt-BR";
export type Localized = Record<Locale, string>;
export type Currency = "USD" | "EUR" | "BRL";
export type Platform = "shopify" | "woocommerce" | "nuvemshop";

export type Category =
  | "candles"
  | "pots-and-vases"
  | "cups-and-mugs"
  | "napkins-and-linen"
  | "serving";

export interface ProductVariant {
  /** Unique across the catalogue, e.g. "CA-CND-001-SAN". Seed scripts match on it (idempotency). */
  sku: string;
  /** Option values in order of Product.options, e.g. ["Sandalwood", "200 g"]. */
  options: string[];
  /** Overrides the product price when set. */
  price?: Partial<Record<Currency, number>>;
  stock: number;
}

export interface Product {
  /** Stable key, also the URL handle/slug, e.g. "aurora-soy-candle". */
  handle: string;
  category: Category;
  title: Localized;
  /** Short HTML-free paragraph used as the listing description. */
  description: Localized;
  /** Bullet points: materials, size, care. Seed scripts render them as a list. */
  details: Record<Locale, string[]>;
  price: Record<Currency, number>;
  /** "Was" price for products on sale. */
  compareAtPrice?: Partial<Record<Currency, number>>;
  /** Option names, e.g. [{en: "Scent", "pt-BR": "Aroma"}]. Empty for single-variant products. */
  options: Localized[];
  variants: ProductVariant[];
  weightGrams: number;
  /** Paths relative to catalog/images/. The first is the main image. */
  images: string[];
  tags: string[];
  /** Products that break often in transit (for damaged-item scenarios). */
  fragile: boolean;
}

export interface Address {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  /** Two-letter province code where the platform wants one, e.g. "NY", "SP". */
  provinceCode?: string;
  zip: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  phone?: string;
}

export interface Customer {
  key: string;
  platform: Platform;
  firstName: string;
  lastName: string;
  /** Always @example.com. */
  email: string;
  locale: Locale;
  address: Address;
  /** Brazil only: a valid-format fake CPF (never a real person's). */
  cpf?: string;
}

export type FinancialStatus = "paid" | "pending" | "refunded" | "partially_refunded" | "voided";
export type FulfillmentStatus = "unfulfilled" | "in_transit" | "delivered" | "stale";

export interface OrderLine {
  sku: string;
  quantity: number;
}

export interface OrderFixture {
  /** Stable key, e.g. "delivered-damaged". Stored on the order (note/tag/metadata) for idempotency. */
  key: string;
  /** Which stores get this order. */
  platforms: Platform[];
  /** One line: why the order exists and which conversation scenario uses it. */
  purpose: string;
  /** Customer key per platform (customers differ per market). */
  customer: Partial<Record<Platform, string>>;
  lines: OrderLine[];
  financialStatus: FinancialStatus;
  fulfillmentStatus: FulfillmentStatus;
  cancelled?: boolean;
  /** Payment method per platform, e.g. { nuvemshop: "pix", woocommerce: "bacs" }. */
  paymentMethod?: Partial<Record<Platform, string>>;
  /** Days before seeding: order placed, shipped, delivered. */
  placedDaysAgo: number;
  shippedDaysAgo?: number;
  deliveredDaysAgo?: number;
  /** Carrier per platform; the tracking number is generated per run as `<prefix><key hash>`. */
  carrier?: Partial<Record<Platform, string>>;
  /** For partially_refunded: SKUs (and quantities) refunded. */
  refundLines?: OrderLine[];
  /** Free text written to the order as a customer or staff note. */
  note?: string;
}
