/**
 * Canonical product schema — the single platform-agnostic shape every
 * `productSource` adapter (and the public ingestion API) must produce.
 *
 * Schema is intentionally Shopify-shaped because Shopify is the first
 * reference adapter; WooCommerce and Magento map cleanly into this form.
 *
 * Adapters own the platform→canonical mapping. Core only ever sees this
 * type and never learns about platform specifics.
 *
 * Idempotency key: (source, externalId) on both products and variants.
 * Descriptions arrive as raw HTML; core sanitizes + converts to markdown
 * at the ingestion boundary (see server/utils/sanitize-html.ts
 * `htmlToSanitizedMarkdown`).
 */

import { ProductStatus } from "../entities/product.entity";
import { VariantAvailability } from "../entities/product-variant.entity";

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
  availability?: VariantAvailability;
  weightValue?: number;
  weightUnit?: string;
  imageSrc?: string;
  attributes?: Record<string, unknown>;
}

export interface CanonicalProduct {
  externalId: string;
  // NOTE: `source` is intentionally NOT part of the canonical shape. Core stamps
  // it at the ingestion boundary (plugin id for plugin sync, "custom"/"manual"
  // for core paths) so adapters can't claim an identity and core never learns
  // platform specifics.
  handle: string;
  title: string;
  /** Raw HTML — core converts to sanitized markdown at the ingestion boundary. */
  descriptionHtml?: string;
  /** Raw HTML — core converts to sanitized markdown at the ingestion boundary. */
  descriptionShortHtml?: string;
  vendor?: string;
  productType?: string;
  status?: ProductStatus;
  tags?: string[];
  categories?: CanonicalCategory[];
  options?: CanonicalOption[];
  images?: CanonicalImage[];
  currency?: string;
  sourceUrl?: string;
  attributes?: Record<string, unknown>;
  /**
   * Variants are required — adapters MUST synthesize a default variant for
   * simple/standalone products so price/availability live consistently on
   * variants. Core enforces this in the sync service.
   */
  variants: CanonicalVariant[];
}
