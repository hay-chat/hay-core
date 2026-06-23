/**
 * Product tools — the Wix Stores Catalog V3 Products API (`/stores/v3/products`).
 *
 * Read-only catalog browsing so the agent can answer "is X in stock / what does
 * Y cost" and resolve a product the buyer mentions into an order line. Search
 * does not return variant data; get_product does.
 */

const { z } = require("zod");
const { wixApi } = require("../lib/client");
const { ok, fail, cursorInfo } = require("../lib/format");

function registerProductTools(server) {
  server.tool(
    "search_products",
    "Search the Wix Stores catalog by free text and/or a filter. Returns one page of products " +
      "(without variant detail — call get_product for variants, pricing and inventory).",
    {
      query: z.string().optional().describe("Free-text search across product name/description."),
      filter: z
        .record(z.any())
        .optional()
        .describe(
          'Raw Wix filter object (MongoDB-style), e.g. {"visible": true} or ' +
            '{"name": {"$startsWith": "Hat"}}.',
        ),
      limit: z.number().optional().describe("Max products per page (default 20, Wix max 100)."),
      cursor: z.string().optional().describe("Cursor from a previous response's nextCursor."),
    },
    async (args) => {
      try {
        const body = {
          ...(args.query ? { search: { expression: args.query } } : {}),
          filter: args.filter,
          cursorPaging: { limit: args.limit ?? 20, cursor: args.cursor },
        };
        const res = await wixApi("POST", "/stores/v3/products/search", { body });
        return ok({ products: res?.products ?? [], ...cursorInfo(res) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "get_product",
    "Get a single catalog product by ID, including its variants, pricing and inventory.",
    { productId: z.string().describe("Wix Stores product ID.") },
    async ({ productId }) => {
      try {
        const res = await wixApi("GET", `/stores/v3/products/${encodeURIComponent(productId)}`);
        return ok(res?.product ?? res);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerProductTools };
