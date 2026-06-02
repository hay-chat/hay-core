/**
 * Hay Plugin SDK - Products / Catalog Sync Types
 *
 * Plugins that ingest a merchant catalog declare the `productSource`
 * capability. They push canonical products to core via the runtime API on
 * `HayStartContext.productSource`. Schema is Shopify-shaped; WooCommerce and
 * Magento map cleanly. Idempotency: (source, externalId).
 *
 * Descriptions are accepted as raw HTML — core sanitizes and converts to
 * markdown at the ingestion boundary so the catalog never persists raw HTML.
 *
 * @module @hay/plugin-sdk/types/products
 */

/** Canonical source identifier — also used as half of the idempotency key. */
export type ProductSourceName = "shopify" | "woocommerce" | "magento" | "custom" | "manual";

export type ProductStatusName = "active" | "draft" | "archived";

export type VariantAvailabilityName = "in_stock" | "out_of_stock" | "backorder";

export interface CanonicalCategory {
  externalId?: string;
  name: string;
  slug?: string;
}

export interface CanonicalOption {
  name: string;
  position: number;
  values: string[];
}

export interface CanonicalImage {
  src: string;
  alt?: string;
  position?: number;
}

export interface CanonicalSelectedOption {
  name: string;
  value: string;
}

export interface CanonicalVariant {
  externalId: string;
  sku?: string;
  barcode?: string;
  title: string;
  selectedOptions?: CanonicalSelectedOption[];
  position?: number;
  price?: number;
  compareAtPrice?: number;
  currency?: string;
  inventoryQuantity?: number;
  inventoryTracked?: boolean;
  availability?: VariantAvailabilityName;
  weightValue?: number;
  weightUnit?: string;
  imageSrc?: string;
  attributes?: Record<string, unknown>;
}

export interface CanonicalProduct {
  externalId: string;
  source: ProductSourceName;
  handle: string;
  title: string;
  /** Raw HTML — core converts to sanitized markdown at the ingestion boundary. */
  descriptionHtml?: string;
  /** Raw HTML — core converts to sanitized markdown at the ingestion boundary. */
  descriptionShortHtml?: string;
  vendor?: string;
  productType?: string;
  status?: ProductStatusName;
  tags?: string[];
  categories?: CanonicalCategory[];
  options?: CanonicalOption[];
  images?: CanonicalImage[];
  currency?: string;
  sourceUrl?: string;
  attributes?: Record<string, unknown>;
  /**
   * Variants are required — adapters MUST synthesize a default variant for
   * simple/standalone products so price/availability live on variants.
   */
  variants: CanonicalVariant[];
}

/**
 * Runtime API on HayStartContext for pushing canonical products to core.
 * Only available when the plugin declares the `products` capability.
 */
export interface HayProductSourceRuntimeAPI {
  /** Bulk upsert. Idempotent on (source, externalId). */
  upsert(products: CanonicalProduct[]): Promise<{ upserted: number; errors: number }>;
  /** Delete a single product by its source-scoped external id. */
  delete(source: ProductSourceName, externalId: string): Promise<{ removed: boolean }>;
}
