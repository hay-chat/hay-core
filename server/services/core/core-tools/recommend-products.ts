/**
 * `recommend_products` core tool — presales/shopping recommendations.
 *
 * Takes a model-formulated need (and optional structured filters) and
 * returns ranked Product+top-variant payloads pulled from the org's
 * mirrored catalog. The orchestrator feeds the result back to the planner
 * which then RESPONDs with a product_recommendation card.
 *
 * Retrieval is hybrid: a vector search (what the shopper means) and a keyword
 * search (exact names, brands, model numbers, SKUs) are fused by rank.
 */

import { In } from "typeorm";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { AppDataSource } from "@server/database/data-source";
import { Product, ProductStatus } from "@server/entities/product.entity";
import { ProductVariant, VariantAvailability } from "@server/entities/product-variant.entity";
import type { VariantSelectedOption } from "@server/entities/product-variant.entity";
import { productVectorStoreService } from "@server/services/product-vector-store.service";
import { productKeywordSearchService } from "@server/services/product-keyword-search.service";
import { createLogger } from "@server/lib/logger";
import { chooseVariant, type OptionFilter } from "@server/lib/product-options";
import { reciprocalRankFusion } from "@server/lib/rank-fusion";
import { variantBuyUrl, withShoppingAttribution } from "@server/lib/shopping-links";
import type { CoreToolDefinition } from "./index";
import { READ_RISK } from "../tool-risk";

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
    options?: OptionFilter[];
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
  /** How many variants the product has: more than one means the shopper must choose. */
  variantCount: number;
  /** What the shopper can choose (size, colour, ...), capped for display. */
  options?: Array<{ name: string; values: string[] }>;
  /** With option filters: how many variants fit them. More than one means a choice is still open. */
  matchingVariantCount?: number;
  /**
   * With option filters, a variant that fits them (the cheapest in stock);
   * otherwise the cheapest in-stock variant.
   */
  topVariant?: {
    id: string;
    externalId: string;
    title: string;
    price?: string;
    compareAtPrice?: string;
    currency?: string;
    sku?: string;
    availability: VariantAvailability;
    selectedOptions?: VariantSelectedOption[];
    /**
     * Adds this variant to the cart or opens checkout. Only set when the
     * variant is in stock and is the only one the shopper could mean: the
     * product has a single variant, or the option filters fit exactly one.
     * We never pick a size or colour for the shopper.
     */
    buyUrl?: string;
  };
}

/** Option values shown per option on a card ("S, M, L, XL +2"). */
const MAX_OPTION_VALUES = 8;

/** A product still in the running, with its vector similarity to the query. */
type Candidate = { product: Product; similarity: number };

export const recommendProductsTool: CoreToolDefinition = {
  name: "recommend_products",
  description:
    "Search the merchant catalog for products that fit a shopper's stated need. " +
    "Use ONLY when the customer is expressing a shopping intent (looking for a " +
    "product, asking for recommendations, comparing options). DO NOT use on " +
    "support, billing, returns, or status questions. If important attributes are " +
    "missing (budget, use-case, size), ASK first, then call this tool. Exact product " +
    "names, brands, model numbers and SKUs the shopper mentions belong in `query` " +
    "verbatim. A size, colour or other variant choice the shopper has stated belongs " +
    "in `filters.options`.",
  risk: READ_RISK,
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
          inStockOnly: {
            type: "boolean",
            default: true,
            description:
              "Defaults to true. Pass false only when the shopper asks about a specific product that may be sold out.",
          },
          categorySlug: { type: "string" },
          productType: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          options: {
            type: "array",
            description:
              "Variant options the shopper has explicitly chosen, e.g. " +
              '[{"name":"size","value":"M"},{"name":"color","value":"blue"}]. Only products ' +
              "with a matching variant are returned (in stock, unless inStockOnly is false), " +
              "and `topVariant` is that variant. Use the generic names `size` and `color`, or " +
              "the option name exactly as a previous result's `options` listed it. Write the " +
              "value as the shopper or the store wrote it. Never pass an option the shopper " +
              "has not stated.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "value"],
              properties: {
                name: { type: "string" },
                value: { type: "string" },
              },
            },
          },
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
    // In-stock only unless the model asks otherwise: a sold-out card is a dead end.
    const optionFilters = parseOptionFilters(parsed.filters?.options);
    const filters = {
      ...parsed.filters,
      inStockOnly: parsed.filters?.inStockOnly !== false,
      options: optionFilters.length ? optionFilters : undefined,
    };

    if (!productVectorStoreService.initialized) {
      await productVectorStoreService.initialize();
    }

    // Over-fetch so structured filters can narrow without immediately starving
    // us of candidates. Option filters cut much deeper, so they get a wider pool.
    const candidatePool = optionFilters.length ? Math.max(limit * 10, 50) : Math.max(limit * 4, 20);

    // The keyword half is an addition: if it fails, recommend on vectors alone.
    const keywordIds = await productKeywordSearchService
      .search(organizationId, query, candidatePool)
      .catch((err) => {
        logger.warn({ err, organizationId }, "Keyword product search failed; using vectors only");
        return [] as string[];
      });
    const hits = await productVectorStoreService.search(
      organizationId,
      query,
      candidatePool,
      keywordIds,
    );
    const similarityById = new Map(hits.map((h) => [h.productId, h.similarity]));
    const vectorIds = hits.slice(0, candidatePool).map((h) => h.productId);
    const rankedIds = reciprocalRankFusion([vectorIds, keywordIds]);

    if (!rankedIds.length) {
      return { products: [], query, filtersApplied: filters };
    }

    const products = await AppDataSource.getRepository(Product).find({
      where: {
        organizationId,
        id: In(rankedIds),
        status: ProductStatus.ACTIVE,
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Apply structured filters server-side.
    const candidates: Candidate[] = rankedIds
      // 0 only for a keyword match whose embedding is missing (not yet embedded).
      .map((id) => ({ product: byId.get(id), similarity: similarityById.get(id) ?? 0 }))
      .filter((row): row is Candidate => !!row.product)
      .filter(({ product }) => {
        const f = filters;
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
      });

    // Option filters are decided per variant, so variants are loaded for every
    // candidate still standing, not only for the finalists.
    const variants = candidates.length
      ? await AppDataSource.getRepository(ProductVariant).find({
          where: { organizationId, productId: In(candidates.map((c) => c.product.id)) },
          order: { position: "ASC" },
        })
      : [];
    const variantsByProduct = new Map<string, ProductVariant[]>();
    for (const v of variants) {
      const arr = variantsByProduct.get(v.productId) ?? [];
      arr.push(v);
      variantsByProduct.set(v.productId, arr);
    }

    const finalists = candidates
      .map((candidate) => {
        const candidateVariants = variantsByProduct.get(candidate.product.id) ?? [];
        const choice = chooseVariant(candidateVariants, optionFilters, filters.inStockOnly);
        return choice ? { ...candidate, candidateVariants, choice } : undefined;
      })
      .filter((row) => row !== undefined)
      .slice(0, limit);

    if (!finalists.length) {
      logger.debug({ organizationId, query }, "No products matched after filters");
      return { products: [], query, filtersApplied: filters };
    }

    const recs: ProductRecommendation[] = finalists.map((finalist) => {
      const { product, similarity, candidateVariants } = finalist;
      const { topVariant, canBuyDirectly, matchingVariantCount } = finalist.choice;
      return {
        id: product.id,
        externalId: product.externalId,
        source: product.source,
        title: product.title,
        handle: product.handle,
        description: product.descriptionShort ?? product.description,
        sourceUrl: withShoppingAttribution(product.sourceUrl, conversation.id),
        vendor: product.vendor,
        productType: product.productType,
        tags: product.tags,
        imageUrl: product.images?.[0]?.src,
        available: product.available,
        similarity,
        variantCount: candidateVariants.length,
        options: displayOptions(product),
        matchingVariantCount,
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
              selectedOptions: topVariant.selectedOptions,
              buyUrl: canBuyDirectly
                ? withShoppingAttribution(variantBuyUrl(topVariant.attributes), conversation.id)
                : undefined,
            }
          : undefined,
      };
    });

    return { products: recs, query, filtersApplied: filters };
  },
};

/** The product's real choices: options with a single value ("Title: Default") are noise. */
function displayOptions(product: Product): ProductRecommendation["options"] {
  const options = (product.options ?? [])
    .filter((option) => Array.isArray(option.values) && option.values.length > 1)
    .map((option) => ({ name: option.name, values: option.values.slice(0, MAX_OPTION_VALUES) }));
  return options.length ? options : undefined;
}

/** Keep only well-formed option filters: the arguments come from a model. */
function parseOptionFilters(raw: unknown): OptionFilter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (option): option is OptionFilter =>
        typeof option?.name === "string" && typeof option?.value === "string",
    )
    .map((option) => ({ name: option.name.trim(), value: option.value.trim() }))
    .filter((option) => option.name && option.value);
}
