/**
 * Product tools — Wix Stores Catalog V3 (`/stores/v3/products`), read-only.
 * Answers "is X in stock / what does Y cost" and resolves a product the buyer
 * mentions. Search returns a compact list; get_product carries variants with
 * their stock status, so there is no separate inventory tool.
 *
 *   POST /stores/v3/products/search   body { search: { search: { expression, fields }, cursorPaging } }
 *   GET  /stores/v3/products/{id}
 */

const { z } = require("zod");
const { wixApi } = require("../lib/client");
const { ok, fail, cursorInfo } = require("../lib/format");

function summarizeProduct(p) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug ?? null,
    visible: p.visible ?? null,
    price: p.actualPriceRange?.minValue ?? p.priceData?.price ?? null,
    inStock: p.inventory?.availabilityStatus ?? p.stock?.inStock ?? null,
  };
}

function summarizeVariants(product) {
  const variants = product?.variantsInfo?.variants ?? product?.variants ?? [];
  return variants.map((v) => ({
    id: v.id,
    sku: v.sku ?? v.physicalProperties?.sku ?? null,
    choices: v.choices ?? null,
    price:
      v.price?.actualPrice?.amount ??
      v.price?.basePrice?.amount ??
      v.variant?.priceData?.price ??
      null,
    inStock: v.inventoryStatus?.inStock ?? v.stock?.inStock ?? null,
    preorderEnabled: v.inventoryStatus?.preorderEnabled ?? null,
  }));
}

/** The fields a support answer needs; the raw product carries media, SEO and rich text. */
function productDetail(p) {
  return {
    ...summarizeProduct(p),
    productType: p.productType ?? null,
    description: p.plainDescription ?? null,
    priceRange: p.actualPriceRange ?? null,
    compareAtPriceRange: p.compareAtPriceRange ?? null,
    options: (p.options || []).map((o) => ({
      name: o.name ?? null,
      choices: (o.choicesSettings?.choices || o.choices || []).map(
        (c) => c.name ?? c.description ?? c.value ?? null,
      ),
    })),
    imageUrl: p.media?.main?.image?.url ?? p.media?.main?.url ?? null,
    variants: summarizeVariants(p),
  };
}

function registerProductTools(server) {
  server.tool(
    "wix_search_products",
    "Search the catalog by free text (name/description). Returns one page of compact products; " +
      "call wix_get_product for variants, pricing and stock.",
    {
      query: z.string().optional().describe("Free-text search across product name/description."),
      limit: z.number().int().optional().describe("Max products per page (default 20, max 100)."),
      cursor: z.string().optional().describe("nextCursor from a previous page."),
    },
    async (args) => {
      try {
        const search = {
          cursorPaging: { limit: Math.min(args.limit ?? 20, 100), cursor: args.cursor },
        };
        if (args.query) {
          search.search = { expression: args.query, fields: ["name", "description"] };
        }
        const res = await wixApi("POST", "/stores/v3/products/search", { body: { search } });
        return ok({ items: (res?.products ?? []).map(summarizeProduct), ...cursorInfo(res) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "wix_get_product",
    "Get a product by id with its options and variants (sku, choices, price, in-stock flag).",
    { product_id: z.string().describe("Wix Stores product id.") },
    async ({ product_id: productId }) => {
      try {
        const res = await wixApi("GET", `/stores/v3/products/${encodeURIComponent(productId)}`);
        const product = res?.product ?? res;
        if (!product || !product.id) {
          throw new Error(`Product ${productId} not found. Find the id with wix_search_products.`);
        }
        return ok(productDetail(product));
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerProductTools };
