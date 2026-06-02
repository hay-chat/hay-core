/**
 * `recommend_products` core tool — presales/shopping recommendations.
 *
 * Takes a model-formulated need (and optional structured filters) and
 * returns ranked Product+top-variant payloads pulled from the org's
 * mirrored catalog. The orchestrator feeds the result back to the planner
 * which then RESPONDs with a product_recommendation card.
 */

import { In } from "typeorm";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { AppDataSource } from "@server/database/data-source";
import { Product, ProductStatus } from "@server/entities/product.entity";
import { ProductVariant, VariantAvailability } from "@server/entities/product-variant.entity";
import { productVectorStoreService } from "@server/services/product-vector-store.service";
import { createLogger } from "@server/lib/logger";
import type { CoreToolDefinition } from "./index";

const logger = createLogger("core-tool:recommend-products");

interface RecommendArgs {
  query: string;
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    inStockOnly?: boolean;
    categorySlug?: string;
    productType?: string;
    tags?: string[];
  };
  limit?: number;
}

interface ProductRecommendation {
  id: string;
  externalId: string;
  source: string;
  title: string;
  handle: string;
  description?: string;
  sourceUrl?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  imageUrl?: string;
  available: boolean;
  similarity: number;
  topVariant?: {
    id: string;
    externalId: string;
    title: string;
    price?: string;
    compareAtPrice?: string;
    currency?: string;
    sku?: string;
    availability: VariantAvailability;
  };
}

export const recommendProductsTool: CoreToolDefinition = {
  name: "recommend_products",
  description:
    "Search the merchant catalog for products that fit a shopper's stated need. " +
    "Use ONLY when the customer is expressing a shopping intent (looking for a " +
    "product, asking for recommendations, comparing options). DO NOT use on " +
    "support, billing, returns, or status questions. If important attributes are " +
    "missing (budget, use-case, size), ASK first, then call this tool.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description:
          "Free-text description of what the customer needs. Synthesize the whole conversation into one self-contained query — DO NOT just echo the last message.",
      },
      filters: {
        type: "object",
        additionalProperties: false,
        properties: {
          minPrice: { type: "number", minimum: 0 },
          maxPrice: { type: "number", minimum: 0 },
          inStockOnly: { type: "boolean" },
          categorySlug: { type: "string" },
          productType: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        default: 4,
      },
    },
  },

  async execute(
    conversation: Conversation,
    args,
  ): Promise<{
    products: ProductRecommendation[];
    query: string;
    filtersApplied: RecommendArgs["filters"];
  }> {
    const organizationId = conversation.organization_id;
    const parsed = args as unknown as RecommendArgs;
    const query = String(parsed.query || "").trim();
    if (!query) {
      return { products: [], query: "", filtersApplied: parsed.filters };
    }
    const limit = Math.min(Math.max(parsed.limit ?? 4, 1), 10);

    if (!productVectorStoreService.initialized) {
      await productVectorStoreService.initialize();
    }

    // Over-fetch from the vector store so structured filters can narrow
    // without immediately starving us of candidates.
    const candidatePool = Math.max(limit * 4, 20);
    const hits = await productVectorStoreService.search(organizationId, query, candidatePool);

    if (!hits.length) {
      return { products: [], query, filtersApplied: parsed.filters };
    }

    const productIds = hits.map((h) => h.productId);
    const products = await AppDataSource.getRepository(Product).find({
      where: {
        organizationId,
        id: In(productIds),
        status: ProductStatus.ACTIVE,
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Apply structured filters server-side.
    const filtered = hits
      .map((h) => ({ hit: h, product: byId.get(h.productId) }))
      .filter((row): row is { hit: (typeof hits)[number]; product: Product } => !!row.product)
      .filter(({ product }) => {
        const f = parsed.filters || {};
        if (f.inStockOnly && !product.available) return false;
        if (f.productType && product.productType !== f.productType) return false;
        if (f.minPrice !== undefined && product.priceMax !== undefined) {
          if (parseFloat(product.priceMax) < f.minPrice) return false;
        }
        if (f.maxPrice !== undefined && product.priceMin !== undefined) {
          if (parseFloat(product.priceMin) > f.maxPrice) return false;
        }
        if (f.tags?.length) {
          const productTags = product.tags ?? [];
          if (!f.tags.some((t) => productTags.includes(t))) return false;
        }
        if (f.categorySlug) {
          const slugs = (product.categories ?? []).map((c) => c.slug).filter(Boolean);
          if (!slugs.includes(f.categorySlug)) return false;
        }
        return true;
      })
      .slice(0, limit);

    if (!filtered.length) {
      logger.debug({ organizationId, query }, "No products matched after filters");
      return { products: [], query, filtersApplied: parsed.filters };
    }

    // Pull the cheapest in-stock variant (fall back to first by position) for each finalist.
    const finalIds = filtered.map((r) => r.product.id);
    const variants = await AppDataSource.getRepository(ProductVariant).find({
      where: { organizationId, productId: In(finalIds) },
      order: { position: "ASC" },
    });
    const variantsByProduct = new Map<string, ProductVariant[]>();
    for (const v of variants) {
      const arr = variantsByProduct.get(v.productId) ?? [];
      arr.push(v);
      variantsByProduct.set(v.productId, arr);
    }

    const recs: ProductRecommendation[] = filtered.map(({ product, hit }) => {
      const candidateVariants = variantsByProduct.get(product.id) ?? [];
      const topVariant = pickTopVariant(candidateVariants);
      return {
        id: product.id,
        externalId: product.externalId,
        source: product.source,
        title: product.title,
        handle: product.handle,
        description: product.descriptionShort ?? product.description,
        sourceUrl: product.sourceUrl,
        vendor: product.vendor,
        productType: product.productType,
        tags: product.tags,
        imageUrl: product.images?.[0]?.src,
        available: product.available,
        similarity: hit.similarity,
        topVariant: topVariant
          ? {
              id: topVariant.id,
              externalId: topVariant.externalId,
              title: topVariant.title,
              price: topVariant.price,
              compareAtPrice: topVariant.compareAtPrice,
              currency: topVariant.currency ?? product.currency,
              sku: topVariant.sku,
              availability: topVariant.availability,
            }
          : undefined,
      };
    });

    return { products: recs, query, filtersApplied: parsed.filters };
  },
};

function pickTopVariant(variants: ProductVariant[]): ProductVariant | undefined {
  if (!variants.length) return undefined;
  // Prefer the cheapest in-stock variant. Fall back to first available, or
  // the first one period.
  const inStock = variants.filter((v) => v.availability === VariantAvailability.IN_STOCK);
  const pool = inStock.length ? inStock : variants;
  return [...pool].sort((a, b) => {
    const pa = a.price !== undefined ? parseFloat(a.price) : Number.POSITIVE_INFINITY;
    const pb = b.price !== undefined ? parseFloat(b.price) : Number.POSITIVE_INFINITY;
    return pa - pb;
  })[0];
}
