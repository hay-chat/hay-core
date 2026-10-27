/**
 * Product tools — read-only catalog access.
 *
 *   woocommerce_search_products  GET /products?search=
 *   woocommerce_get_product      GET /products/{id} (+ /variations for variable products)
 *   woocommerce_check_inventory  GET /products?sku=  (matches simple products AND variations)
 */

const { z } = require("zod");
const { wcApi, wcList, WooApiError } = require("../lib/client");
const { ok, fail, toolError } = require("../lib/format");

function summarizeProduct(p) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku || null,
    type: p.type,
    status: p.status,
    price: p.price,
    regularPrice: p.regular_price,
    salePrice: p.sale_price || null,
    onSale: Boolean(p.on_sale),
    stockStatus: p.stock_status,
    stockQuantity: p.stock_quantity ?? null,
    permalink: p.permalink,
    parentId: p.parent_id || null,
    attributes: (p.attributes || []).map((a) => ({
      name: a.name,
      option: a.option ?? a.options ?? null,
    })),
  };
}

function registerProductTools(server) {
  server.tool(
    "woocommerce_search_products",
    "Search published products by name/description. Returns one page of compact products; call " +
      "woocommerce_get_product for variants and stock per variant.",
    {
      query: z.string().describe("Search text."),
      limit: z.number().int().optional().describe("Products per page (default 10, max 100)."),
      page: z.number().int().optional().describe("Page number (default 1)."),
    },
    async ({ query, limit, page }) => {
      try {
        const { items, total, totalPages } = await wcList("/products", {
          search: query,
          status: "publish",
          per_page: Math.min(limit ?? 10, 100),
          page: page ?? 1,
        });
        return ok({ items: items.map(summarizeProduct), page: page ?? 1, totalPages, total });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_get_product",
    "Get a product by id with price, stock and — for variable products — every variation " +
      "(sku, attributes, price, stock).",
    { product_id: z.string().describe("WooCommerce product id.") },
    async ({ product_id: productId }) => {
      try {
        let product;
        try {
          product = await wcApi("GET", `/products/${encodeURIComponent(productId)}`);
        } catch (err) {
          if (err instanceof WooApiError && err.status === 404) {
            throw toolError(
              "NOT_FOUND",
              `Product ${productId} not found. Find the id with woocommerce_search_products.`,
            );
          }
          throw err;
        }
        let variations = [];
        if (product.type === "variable") {
          const { items } = await wcList(`/products/${product.id}/variations`, { per_page: 100 });
          variations = items.map(summarizeProduct);
        }
        return ok({
          ...summarizeProduct(product),
          description: product.short_description || product.description || null,
          categories: (product.categories || []).map((c) => c.name),
          variations,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_check_inventory",
    "Check stock for a SKU (simple product or variation): stock status, quantity and price.",
    { sku: z.string().describe("Product or variation SKU.") },
    async ({ sku }) => {
      try {
        const { items } = await wcList("/products", { sku, per_page: 5 });
        const match =
          items.find((p) => String(p.sku).toLowerCase() === sku.toLowerCase()) || items[0];
        if (!match) {
          return ok({ found: false, sku, message: `No product or variation with SKU "${sku}".` });
        }
        return ok({
          found: true,
          ...summarizeProduct(match),
          inStock: match.stock_status === "instock",
          backorders: match.backorders ?? null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerProductTools, summarizeProduct };
