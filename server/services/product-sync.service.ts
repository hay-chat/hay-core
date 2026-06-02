/**
 * Product Sync Service
 *
 * Normalizes CanonicalProduct payloads (from plugin adapters or the public
 * ingestion API) into the products / product_variants / product_embeddings
 * tables. One unified path so the same idempotency guarantees apply
 * regardless of source.
 *
 * Embedding policy: (re)compute searchText = title + description (plaintext)
 * + vendor + productType + tags + option names + category names + variant
 * titles. Embed only when searchText changes — pure price/stock updates do
 * not trigger re-embed.
 */

import type { EntityManager } from "typeorm";
import { AppDataSource } from "../database/data-source";
import { Product, ProductSource, ProductStatus } from "../entities/product.entity";
import { ProductVariant, VariantAvailability } from "../entities/product-variant.entity";
import { htmlToSanitizedMarkdown } from "../utils/sanitize-html";
import { sanitizeContent } from "../utils/sanitize";
import { productVectorStoreService } from "./product-vector-store.service";
import { auditLogService } from "./audit-log.service";
import { createLogger } from "@server/lib/logger";
import type { CanonicalProduct, CanonicalVariant } from "../types/canonical-product";

const logger = createLogger("product-sync");

export interface ProductSyncResult {
  productId: string;
  created: boolean;
  embeddingRefreshed: boolean;
}

export interface BulkSyncResult {
  upserted: number;
  errors: Array<{ externalId: string; message: string }>;
}

export class ProductSyncService {
  /**
   * Bulk upsert. Continues on per-item errors so a single bad product
   * doesn't fail an entire sync batch.
   */
  async upsertProducts(
    organizationId: string,
    products: CanonicalProduct[],
  ): Promise<BulkSyncResult> {
    const result: BulkSyncResult = { upserted: 0, errors: [] };

    for (const product of products) {
      try {
        await this.upsertProduct(organizationId, product);
        result.upserted++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { err, organizationId, source: product.source, externalId: product.externalId },
          "Failed to upsert product",
        );
        result.errors.push({ externalId: product.externalId, message });
      }
    }

    // Audit the batch result. Errors are swallowed inside auditLog itself,
    // but keep this defensive in case it ever changes.
    if (products.length > 0) {
      const source = products[0].source;
      try {
        await auditLogService.logProductSync(undefined, organizationId, source, {
          upserted: result.upserted,
          errors: result.errors.length,
        });
      } catch (err) {
        logger.error({ err }, "Failed to write product sync audit log");
      }
    }

    return result;
  }

  /**
   * Idempotent upsert of one canonical product (and its variants).
   * Re-embeds only when the derived search text changes.
   */
  async upsertProduct(
    organizationId: string,
    canonical: CanonicalProduct,
  ): Promise<ProductSyncResult> {
    this.validateCanonical(canonical);

    const description = htmlToSanitizedMarkdown(canonical.descriptionHtml);
    const descriptionShort = htmlToSanitizedMarkdown(canonical.descriptionShortHtml);
    const searchText = this.buildSearchText({
      ...canonical,
      // Use already-converted plaintext for the search text.
      descriptionHtml: description || undefined,
    });

    const { priceMin, priceMax, available, currency } = this.rollupVariantPricing(
      canonical.variants,
      canonical.currency,
    );

    return AppDataSource.transaction(async (manager) => {
      const productRepo = manager.getRepository(Product);
      const variantRepo = manager.getRepository(ProductVariant);

      const existing = await productRepo.findOne({
        where: { organizationId, source: canonical.source, externalId: canonical.externalId },
      });

      const status = canonical.status ?? ProductStatus.ACTIVE;
      const tags = canonical.tags ?? [];

      const product = existing ?? new Product();
      product.organizationId = organizationId;
      product.externalId = canonical.externalId;
      product.source = canonical.source;
      product.handle = canonical.handle;
      product.title = sanitizeContent(canonical.title);
      product.description = description || undefined;
      product.descriptionShort = descriptionShort || undefined;
      product.vendor = canonical.vendor;
      product.productType = canonical.productType;
      product.status = status;
      product.tags = tags;
      product.categories = canonical.categories;
      product.options = canonical.options;
      product.images = canonical.images;
      product.currency = currency;
      product.priceMin = priceMin;
      product.priceMax = priceMax;
      product.available = available;
      product.searchText = searchText;
      product.attributes = canonical.attributes;
      product.sourceUrl = canonical.sourceUrl;

      const saved = await productRepo.save(product);
      const created = !existing;

      await this.syncVariants(manager, organizationId, saved.id, canonical);

      const searchTextChanged = !existing || existing.searchText !== searchText;
      let embeddingRefreshed = false;

      if (searchTextChanged && searchText.length > 0) {
        await productVectorStoreService.upsertProductEmbeddings(
          organizationId,
          [
            {
              productId: saved.id,
              content: searchText,
              metadata: {
                productId: saved.id,
                source: canonical.source,
                externalId: canonical.externalId,
                title: saved.title,
                handle: saved.handle,
              },
            },
          ],
          manager,
        );
        embeddingRefreshed = true;
      }

      logger.debug(
        {
          organizationId,
          productId: saved.id,
          created,
          embeddingRefreshed,
          variants: canonical.variants.length,
        },
        "Product upserted",
      );

      // Best-effort audit — swallow failures so a slow audit table never
      // blocks ingestion.
      try {
        await auditLogService.logProductUpsert(
          undefined,
          organizationId,
          saved.id,
          {
            source: canonical.source,
            externalId: canonical.externalId,
            title: saved.title,
          },
          { created, embeddingRefreshed },
        );
      } catch (err) {
        logger.error({ err, productId: saved.id }, "Failed to write product audit log");
      }

      return { productId: saved.id, created, embeddingRefreshed };
    });
  }

  /**
   * Delete a product (and cascade variants + embeddings via FKs) by its
   * canonical (source, externalId) idempotency key.
   */
  async deleteProductByExternalId(
    organizationId: string,
    source: ProductSource,
    externalId: string,
  ): Promise<boolean> {
    const repo = AppDataSource.getRepository(Product);
    const row = await repo.findOne({
      where: { organizationId, source, externalId },
    });
    if (!row) return false;

    // Embeddings cascade via FK; remove explicitly for symmetry with the
    // documents pattern (and so the vector index is reaped immediately).
    await productVectorStoreService.deleteByProductId(organizationId, row.id);
    await repo.delete({ id: row.id });

    try {
      await auditLogService.logProductDelete(undefined, organizationId, row.id, {
        source,
        externalId,
      });
    } catch (err) {
      logger.error({ err, productId: row.id }, "Failed to write product delete audit log");
    }
    return true;
  }

  /**
   * Replace the variant set for a product. Variants present in the canonical
   * payload are upserted; variants whose externalId no longer appears are
   * deleted (their embeddings cascade away).
   */
  private async syncVariants(
    manager: EntityManager,
    organizationId: string,
    productId: string,
    canonical: CanonicalProduct,
  ): Promise<void> {
    const variantRepo = manager.getRepository(ProductVariant);

    const incomingByExternalId = new Map(canonical.variants.map((v) => [v.externalId, v]));

    const existing = await variantRepo.find({
      where: { organizationId, productId },
    });
    const existingByExternalId = new Map(existing.map((v) => [v.externalId, v]));

    // Upsert
    for (const [externalId, v] of incomingByExternalId) {
      const row = existingByExternalId.get(externalId) ?? new ProductVariant();
      row.organizationId = organizationId;
      row.productId = productId;
      row.externalId = externalId;
      row.source = canonical.source;
      row.sku = v.sku;
      row.barcode = v.barcode;
      row.title = sanitizeContent(v.title || "");
      row.selectedOptions = v.selectedOptions;
      row.position = v.position;
      row.price = v.price !== undefined ? v.price.toFixed(2) : undefined;
      row.compareAtPrice = v.compareAtPrice !== undefined ? v.compareAtPrice.toFixed(2) : undefined;
      row.currency = v.currency ?? canonical.currency;
      row.inventoryQuantity = v.inventoryQuantity;
      row.inventoryTracked = v.inventoryTracked ?? false;
      row.availability = v.availability ?? VariantAvailability.IN_STOCK;
      row.weightValue = v.weightValue !== undefined ? v.weightValue.toFixed(3) : undefined;
      row.weightUnit = v.weightUnit;
      row.imageSrc = v.imageSrc;
      row.attributes = v.attributes;
      await variantRepo.save(row);
    }

    // Delete variants that no longer exist upstream
    const toDelete = existing.filter((v) => !incomingByExternalId.has(v.externalId));
    if (toDelete.length) {
      await variantRepo.remove(toDelete);
    }
  }

  private validateCanonical(p: CanonicalProduct): void {
    if (!p.externalId) throw new Error("CanonicalProduct.externalId is required");
    if (!p.source) throw new Error("CanonicalProduct.source is required");
    if (!p.handle) throw new Error("CanonicalProduct.handle is required");
    if (!p.title) throw new Error("CanonicalProduct.title is required");
    if (!p.variants || p.variants.length === 0) {
      throw new Error(
        "CanonicalProduct.variants must contain at least one variant — synthesize a default for simple products",
      );
    }
  }

  private buildSearchText(p: CanonicalProduct & { descriptionHtml?: string }): string {
    const parts: string[] = [];
    parts.push(p.title);
    if (p.descriptionHtml) parts.push(p.descriptionHtml);
    if (p.descriptionShortHtml) parts.push(p.descriptionShortHtml);
    if (p.vendor) parts.push(`Vendor: ${p.vendor}`);
    if (p.productType) parts.push(`Type: ${p.productType}`);
    if (p.tags?.length) parts.push(`Tags: ${p.tags.join(", ")}`);
    if (p.categories?.length) {
      parts.push(`Categories: ${p.categories.map((c) => c.name).join(", ")}`);
    }
    if (p.options?.length) {
      parts.push(
        `Options: ${p.options.map((o) => `${o.name} (${o.values.join("/")})`).join(", ")}`,
      );
    }
    if (p.variants?.length) {
      const variantTitles = p.variants
        .map((v) => v.title)
        .filter((t) => t && t !== "Default Title")
        .join(", ");
      if (variantTitles) parts.push(`Variants: ${variantTitles}`);
    }

    return sanitizeContent(parts.join("\n"));
  }

  private rollupVariantPricing(
    variants: CanonicalVariant[],
    fallbackCurrency?: string,
  ): {
    priceMin?: string;
    priceMax?: string;
    available: boolean;
    currency?: string;
  } {
    const prices: number[] = [];
    let available = false;
    let currency: string | undefined = fallbackCurrency;

    for (const v of variants) {
      if (typeof v.price === "number" && !Number.isNaN(v.price)) {
        prices.push(v.price);
      }
      if (v.availability === VariantAvailability.IN_STOCK) {
        available = true;
      }
      if (v.currency && !currency) currency = v.currency;
    }

    if (!prices.length) {
      return { available, currency };
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      priceMin: min.toFixed(2),
      priceMax: max.toFixed(2),
      available,
      currency,
    };
  }
}

export const productSyncService = new ProductSyncService();
