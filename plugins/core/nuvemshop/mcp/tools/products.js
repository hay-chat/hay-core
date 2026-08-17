// tools/products.js — Nuvemshop product & category tools.
// Registrar: registerProductTools
//
// Product name/description/handle are i18n objects ({es, pt, en}); every tool
// takes an optional `language` and flattens responses to one language via
// slimProduct so the agent reads a single translation.

const { z } = require("zod");
const { nuvemshopApi } = require("../lib/client");
const { ok, fail, pickLang, slimProduct } = require("../lib/format");

const languageParam = z
  .string()
  .optional()
  .describe(
    "Language code for localized fields (e.g. 'pt', 'es', 'en'). Defaults to the store's main language.",
  );

function registerProductTools(server) {
  server.tool(
    "nuvemshop_search_products",
    "Search the store's products by free text (matches product names, descriptions and SKUs). " +
      "Optionally filter by category or published state. Returns { items, total, page } with " +
      "compact products (variants include price, promotional_price and stock). " +
      "For one specific product use nuvemshop_get_product or nuvemshop_get_product_by_sku.",
    {
      q: z.string().optional().describe("Free-text search over names, descriptions and SKUs"),
      category_id: z.number().int().optional().describe("Only products in this category"),
      published: z.boolean().optional().describe("Filter by published (visible in storefront)"),
      page: z.number().int().optional().describe("1-based page number (default 1)"),
      per_page: z.number().int().optional().describe("Results per page, max 200 (default 25)"),
      language: languageParam,
    },
    async (args) => {
      try {
        const { data, total } = await nuvemshopApi("GET", "/products", {
          query: {
            q: args.q,
            category_id: args.category_id,
            published: args.published,
            page: args.page ?? 1,
            per_page: args.per_page ?? 25,
          },
          withMeta: true,
        });
        return ok({
          items: (data ?? []).map((product) => slimProduct(product, args.language)),
          total,
          page: args.page ?? 1,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "nuvemshop_get_product",
    "Get a single product by its numeric ID, including all variants (price, promotional price, " +
      "stock), images, categories and attributes.",
    {
      product_id: z.number().int().describe("Numeric product ID"),
      language: languageParam,
    },
    async (args) => {
      try {
        const product = await nuvemshopApi("GET", `/products/${args.product_id}`);
        return ok(slimProduct(product, args.language));
      } catch (err) {
        if (err && err.status === 404) {
          return fail(
            new Error(
              `Product ${args.product_id} not found. If you only have a name or SKU, use ` +
                "nuvemshop_search_products or nuvemshop_get_product_by_sku.",
            ),
          );
        }
        return fail(err);
      }
    },
  );

  server.tool(
    "nuvemshop_get_product_by_sku",
    "Get a single product by one of its variants' SKU (exact match).",
    {
      sku: z.string().describe("Variant SKU, e.g. 'BSG1234A'"),
      language: languageParam,
    },
    async (args) => {
      try {
        const product = await nuvemshopApi("GET", `/products/sku/${encodeURIComponent(args.sku)}`);
        return ok(slimProduct(product, args.language));
      } catch (err) {
        if (err && err.status === 404) {
          return fail(
            new Error(
              `No product has a variant with SKU "${args.sku}". Try nuvemshop_search_products — ` +
                "its free-text search also matches SKUs.",
            ),
          );
        }
        return fail(err);
      }
    },
  );

  server.tool(
    "nuvemshop_list_categories",
    "List the store's product categories (id, name, parent, subcategories). Use a category id " +
      "with nuvemshop_search_products to browse a category's products.",
    {
      parent_id: z.number().int().optional().describe("Only direct children of this category"),
      page: z.number().int().optional().describe("1-based page number (default 1)"),
      per_page: z.number().int().optional().describe("Results per page, max 200 (default 50)"),
      language: languageParam,
    },
    async (args) => {
      try {
        const { data, total } = await nuvemshopApi("GET", "/categories", {
          query: {
            parent_id: args.parent_id,
            page: args.page ?? 1,
            per_page: args.per_page ?? 50,
          },
          withMeta: true,
        });
        return ok({
          items: (data ?? []).map((category) => ({
            id: category.id,
            name: pickLang(category.name, args.language),
            parent: category.parent,
            subcategories: category.subcategories,
          })),
          total,
          page: args.page ?? 1,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerProductTools };
