// Shared enums and structural types for Product / ProductVariant entities.
// Kept in a dependency-free module so the two entities can reference these
// without importing each other at decorator-evaluation time (which caused a
// circular-import crash: TypeORM saw `enum: undefined`).

/**
 * A product's `source` is a free-form string, NOT a core-enumerated set —
 * core must never hardcode which plugins exist. For plugin-ingested products
 * the value is the authenticated plugin id (stamped by core at the ingestion
 * boundary); display names are resolved dynamically from the plugin registry.
 *
 * The only source values core owns are its two non-plugin ingestion paths:
 * the public ingestion API (`custom`) and manual dashboard entry (`manual`).
 */
export const CORE_PRODUCT_SOURCES = {
  CUSTOM: "custom",
  MANUAL: "manual",
} as const;

export type CoreProductSource = (typeof CORE_PRODUCT_SOURCES)[keyof typeof CORE_PRODUCT_SOURCES];

export enum ProductStatus {
  ACTIVE = "active",
  DRAFT = "draft",
  ARCHIVED = "archived",
}

export enum VariantAvailability {
  IN_STOCK = "in_stock",
  OUT_OF_STOCK = "out_of_stock",
  BACKORDER = "backorder",
}

export interface ProductCategoryRef {
  externalId?: string;
  name: string;
  slug?: string;
}

export interface ProductOptionDef {
  name: string;
  position: number;
  values: string[];
}

export interface ProductImage {
  src: string;
  alt?: string;
  position?: number;
}

export interface VariantSelectedOption {
  name: string;
  value: string;
}
