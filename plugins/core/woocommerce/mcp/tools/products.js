/**
 * Product tools — read-only catalog access.
 *
 *   woocommerce_search_products  GET /products?search=
 *   woocommerce_get_product      GET /products/{id} (+ /variations for variable products)
 *   woocommerce_get_product_by_slug  GET /products?slug=  (accepts a storefront URL)
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

/** Full product view: summary, description, categories and every variation. */
async function productDetail(product) {
  let variations = [];
  if (product.type === "variable") {
    const { items } = await wcList(`/products/${product.id}/variations`, { per_page: 100 });
    variations = items.map(summarizeProduct);
  }
  return {
    ...summarizeProduct(product),
    description: product.short_description || product.description || null,
    categories: (product.categories || []).map((c) => c.name),
    variations,
  };
}

/**
 * The product slug in a storefront link or a bare slug: the last path segment
 * of https://shop.com/product/blue-shirt/ (or its ?product= query), so a
 * shopper can paste the page they are looking at.
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function slugFrom(input) {
  const raw = String(input || "").trim();
  if (!/^https?:\/\//i.test(raw) && !raw.includes("/")) return safeDecode(raw);
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://placeholder.invalid/${raw}`);
  } catch {
    return "";
  }
  const fromQuery = url.searchParams.get("product");
  if (fromQuery) return fromQuery;
  const segments = url.pathname.split("/").filter(Boolean);
  return safeDecode(segments[segments.length - 1] || "");
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
        return ok(await productDetail(product));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "woocommerce_get_product_by_slug",
    "Get a product from its storefront link or slug (e.g. a URL the customer pasted), with price, " +
      "stock and every variation. Same output as woocommerce_get_product.",
    {
      slug_or_url: z
        .string()
        .min(1)
        .describe(
          'Product page URL (https://shop.com/product/blue-shirt/) or slug ("blue-shirt").',
        ),
    },
    async ({ slug_or_url: input }) => {
      try {
        const slug = slugFrom(input);
        if (!slug) throw toolError("BAD_INPUT", `"${input}" is not a product link or slug.`);
        const { items } = await wcList("/products", { slug, per_page: 1 });
        if (!items.length) {
          throw toolError(
            "NOT_FOUND",
            `No product with slug "${slug}". Search by name with woocommerce_search_products.`,
          );
        }
        return ok(await productDetail(items[0]));
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

module.exports = { registerProductTools, summarizeProduct, slugFrom };
