/**
 * Product tools — read-only catalog access.
 *
 *   nuvemshop_search_products  GET /products?q=&published=true
 *   nuvemshop_get_product      GET /products/{id}
 *   nuvemshop_check_inventory  GET /products/sku/{sku} → the matching variant
 *   nuvemshop_list_categories  GET /categories
 *
 * i18n fields ({es, pt, en}) are flattened to one language (the store's main
 * language unless `language` is passed). Stock: variant `stock` (null =
 * unlimited) or, on 2025-03 multi-inventory stores, the sum of
 * `inventory_levels[].stock`.
 */

const { z } = require("zod");
const { nsApi, nsList, NuvemshopApiError } = require("../lib/client");
const { ok, fail, toolError, pickLang, READ } = require("../lib/format");

const languageParam = z
  .string()
  .optional()
  .describe(
    "Language for names/descriptions ('pt', 'es', 'en'). Defaults to the store's main language.",
  );

/** Total stock for a variant; null means untracked/unlimited. */
function variantStock(variant) {
  if (variant.stock !== undefined && variant.stock !== null) return Number(variant.stock);
  if (Array.isArray(variant.inventory_levels) && variant.inventory_levels.length) {
    let total = 0;
    for (const level of variant.inventory_levels) {
      if (level.stock === null || level.stock === undefined) return null;
      total += Number(level.stock);
    }
    return total;
  }
  return null;
}

function summarizeVariant(variant, product, lang) {
  const stock = variantStock(variant);
  const tracked = variant.stock_management === true && stock !== null;
  return {
    id: variant.id,
    sku: variant.sku || null,
    options: (variant.values || []).map((v) => pickLang(v, lang)).filter(Boolean),
    price: variant.price ?? null,
    promotionalPrice: variant.promotional_price || null,
    stockQuantity: tracked ? stock : null,
    stockTracked: tracked,
    inStock: tracked ? stock > 0 : true,
  };
}

function summarizeProduct(product, lang) {
  const variants = (product.variants || []).map((v) => summarizeVariant(v, product, lang));
  return {
    id: product.id,
    name: pickLang(product.name, lang),
    handle: pickLang(product.handle, lang),
    published: product.published ?? null,
    brand: product.brand || null,
    url: product.canonical_url || null,
    price: variants[0]?.price ?? null,
    promotionalPrice: variants[0]?.promotionalPrice ?? null,
    inStock: variants.some((v) => v.inStock),
    options: (product.attributes || []).map((a) => pickLang(a, lang)).filter(Boolean),
    variantCount: variants.length,
  };
}

function registerProductTools(server) {
  server.registerTool(
    "nuvemshop_search_products",
    {
      description:
        "Search published products by name, description or SKU. Returns one page of compact " +
        "products; call nuvemshop_get_product for variants and stock per variant.",
      inputSchema: {
        query: z.string().describe("Search text."),
        category_id: z.string().optional().describe("Only products in this category id."),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Products per page (default 10, max 50)."),
        page: z.number().int().min(1).optional().describe("Page number (default 1)."),
        language: languageParam,
      },
      annotations: READ,
    },
    async ({ query, category_id: categoryId, limit, page, language }) => {
      try {
        const { items, total } = await nsList("/products", {
          q: query,
          category_id: categoryId,
          published: true,
          per_page: Math.min(limit ?? 10, 50),
          page: page ?? 1,
        });
        return ok({
          items: items
            .filter((p) => p.published !== false)
            .map((p) => summarizeProduct(p, language)),
          page: page ?? 1,
          total,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_get_product",
    {
      description:
        "Get a product by id with description, categories and every variant (sku, options, " +
        "price, promotional price, stock).",
      inputSchema: {
        product_id: z.string().describe("Nuvemshop product id."),
        language: languageParam,
      },
      annotations: READ,
    },
    async ({ product_id: productId, language }) => {
      try {
        let product;
        try {
          product = await nsApi("GET", `/products/${encodeURIComponent(productId)}`);
        } catch (err) {
          if (err instanceof NuvemshopApiError && err.status === 404) {
            throw toolError(
              "NOT_FOUND",
              `Product ${productId} not found. Find the id with nuvemshop_search_products.`,
            );
          }
          throw err;
        }
        const description = pickLang(product.description, language);
        return ok({
          ...summarizeProduct(product, language),
          description: description
            ? description
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 2000)
            : null,
          categories: (product.categories || [])
            .filter((c) => typeof c === "object")
            .map((c) => ({ id: c.id, name: pickLang(c.name, language) })),
          images: (product.images || []).slice(0, 5).map((i) => i.src),
          variants: (product.variants || []).map((v) => summarizeVariant(v, product, language)),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_check_inventory",
    {
      description:
        "Check stock for a variant SKU: in stock or not, quantity when tracked, price, and the " +
        "product it belongs to.",
      inputSchema: { sku: z.string().describe("Variant SKU."), language: languageParam },
      annotations: READ,
    },
    async ({ sku, language }) => {
      try {
        let product;
        try {
          product = await nsApi("GET", `/products/sku/${encodeURIComponent(sku.trim())}`);
        } catch (err) {
          if (err instanceof NuvemshopApiError && err.status === 404) {
            return ok({ found: false, sku, message: `No product variant with SKU "${sku}".` });
          }
          throw err;
        }
        const variant = (product.variants || []).find(
          (v) => String(v.sku || "").toLowerCase() === sku.trim().toLowerCase(),
        );
        if (!variant) {
          return ok({ found: false, sku, message: `No product variant with SKU "${sku}".` });
        }
        return ok({
          found: true,
          sku: variant.sku,
          product: {
            id: product.id,
            name: pickLang(product.name, language),
            published: product.published ?? null,
          },
          ...summarizeVariant(variant, product, language),
          locations: Array.isArray(variant.inventory_levels)
            ? variant.inventory_levels.map((l) => ({
                locationId: l.location_id ?? null,
                stock: l.stock ?? null,
              }))
            : null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_list_categories",
    {
      description:
        "List the store's product categories (id, name, parent). Pass a category id to " +
        "nuvemshop_search_products to browse it.",
      inputSchema: {
        parent_id: z.string().optional().describe("Only direct children of this category."),
        page: z.number().int().min(1).optional().describe("Page number (default 1)."),
        language: languageParam,
      },
      annotations: READ,
    },
    async ({ parent_id: parentId, page, language }) => {
      try {
        const { items, total } = await nsList("/categories", {
          parent_id: parentId,
          per_page: 50,
          page: page ?? 1,
        });
        return ok({
          items: items.map((c) => ({
            id: c.id,
            name: pickLang(c.name, language),
            parent: c.parent ?? null,
          })),
          page: page ?? 1,
          total,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerProductTools, variantStock, summarizeProduct, summarizeVariant };
