/**
 * Product tools — read-only catalog access.
 *
 *   magento_search_products  GET /products?searchCriteria (name like)
 *   magento_get_product      GET /products/{sku} + /stockItems/{sku} (+ configurable children)
 *   magento_check_inventory  GET /stockItems/{sku}
 */

const { z } = require("zod");
const { magentoApi, searchCriteria, MagentoApiError } = require("../lib/client");
const { ok, fail, customAttributes } = require("../lib/format");

function summarizeProduct(p) {
  const attrs = customAttributes(p);
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    type: p.type_id,
    status: p.status === 1 ? "enabled" : "disabled",
    price: p.price ?? null,
    specialPrice: attrs.special_price ?? null,
    urlKey: attrs.url_key ?? null,
    inStock: p.extension_attributes?.stock_item?.is_in_stock ?? null,
    quantity: p.extension_attributes?.stock_item?.qty ?? null,
  };
}

async function getStock(sku) {
  try {
    const s = await magentoApi("GET", `/stockItems/${encodeURIComponent(sku)}`);
    return s
      ? {
          inStock: Boolean(s.is_in_stock),
          quantity: s.qty ?? null,
          manageStock: s.manage_stock ?? null,
          backorders: s.backorders ?? null,
        }
      : null;
  } catch (err) {
    if (err instanceof MagentoApiError && err.status === 404) return null;
    throw err;
  }
}

function registerProductTools(server) {
  server.tool(
    "magento_search_products",
    "Search enabled products by name. Returns one page of compact products; call " +
      "magento_get_product for a product's options, stock and description.",
    {
      query: z.string().describe("Text to match against product names."),
      limit: z.number().int().optional().describe("Products per page (default 10, max 100)."),
      page: z.number().int().optional().describe("Page number (default 1)."),
    },
    async ({ query, limit, page }) => {
      try {
        const pageSize = Math.min(limit ?? 10, 100);
        const res = await magentoApi("GET", "/products", {
          query: searchCriteria(
            [
              { field: "name", value: `%${query}%`, condition: "like" },
              { field: "status", value: 1 },
            ],
            { pageSize, currentPage: page ?? 1 },
          ),
        });
        const total = res?.total_count ?? 0;
        return ok({
          items: (res?.items ?? []).map(summarizeProduct),
          page: page ?? 1,
          totalPages: Math.ceil(total / pageSize),
          total,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "magento_get_product",
    "Get a product by SKU with price, stock, description and — for configurable products — " +
      "every child variant (sku, price, stock).",
    { sku: z.string().describe("Product SKU.") },
    async ({ sku }) => {
      try {
        let product;
        try {
          product = await magentoApi("GET", `/products/${encodeURIComponent(sku)}`);
        } catch (err) {
          if (err instanceof MagentoApiError && err.status === 404) {
            throw new Error(
              `Product "${sku}" not found. Find the SKU with magento_search_products.`,
            );
          }
          throw err;
        }
        const attrs = customAttributes(product);
        const [stock, children] = await Promise.all([
          getStock(product.sku),
          product.type_id === "configurable"
            ? magentoApi(
                "GET",
                `/configurable-products/${encodeURIComponent(product.sku)}/children`,
              ).catch(() => [])
            : Promise.resolve([]),
        ]);
        const variants = await Promise.all(
          (children || []).map(async (c) => ({
            ...summarizeProduct(c),
            stock: await getStock(c.sku).catch(() => null),
          })),
        );
        return ok({
          ...summarizeProduct(product),
          description: attrs.short_description ?? attrs.description ?? null,
          stock,
          variants,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "magento_check_inventory",
    "Check stock for a SKU (simple product or configurable child): in-stock flag and quantity.",
    { sku: z.string().describe("Product SKU.") },
    async ({ sku }) => {
      try {
        const stock = await getStock(sku);
        if (!stock) return ok({ found: false, sku, message: `No product with SKU "${sku}".` });
        return ok({ found: true, sku, ...stock });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerProductTools, summarizeProduct };
