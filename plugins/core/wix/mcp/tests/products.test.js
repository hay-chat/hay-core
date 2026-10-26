import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerProductTools } = require("../tools/products");

process.env.WIX_API_KEY = "test-key";
process.env.WIX_SITE_ID = "site-1";

const PRODUCT = {
  id: "prod-1",
  name: "Hat",
  slug: "hat",
  visible: true,
  productType: "PHYSICAL",
  plainDescription: "A hat.",
  description: { nodes: [{ type: "PARAGRAPH" }] },
  seoData: { tags: [] },
  media: { main: { image: { url: "https://img/hat.jpg" } } },
  actualPriceRange: { minValue: { amount: "25.00" }, maxValue: { amount: "30.00" } },
  inventory: { availabilityStatus: "IN_STOCK" },
  options: [{ name: "Size", choicesSettings: { choices: [{ name: "S" }, { name: "M" }] } }],
  variantsInfo: {
    variants: [
      {
        id: "v-1",
        sku: "HAT-S",
        choices: [{ optionChoiceNames: { optionName: "Size", choiceName: "S" } }],
        price: { actualPrice: { amount: "25.00" } },
        inventoryStatus: { inStock: true, preorderEnabled: false },
      },
    ],
  },
};

describe("product tools", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerProductTools(server);
  });

  it("wix_search_products wraps the free-text search in the CursorSearch envelope", async () => {
    const { calls } = mockFetch([
      {
        method: "POST",
        path: "/stores/v3/products/search",
        reply: () => ({
          products: [PRODUCT],
          pagingMetadata: { hasNext: true, cursors: { next: "c2" } },
        }),
      },
    ]);
    const res = await server.call("wix_search_products", { query: "hat", limit: 500 });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({
      items: [
        {
          id: "prod-1",
          name: "Hat",
          slug: "hat",
          visible: true,
          price: { amount: "25.00" },
          inStock: "IN_STOCK",
        },
      ],
      hasNext: true,
      nextCursor: "c2",
    });
    expect(calls[0].body).toEqual({
      search: {
        cursorPaging: { limit: 100 },
        search: { expression: "hat", fields: ["name", "description"] },
      },
    });
  });

  it("wix_get_product projects the support-relevant fields and the variants", async () => {
    mockFetch([
      { method: "GET", path: "/stores/v3/products/prod-1", reply: () => ({ product: PRODUCT }) },
    ]);
    const res = await server.call("wix_get_product", { product_id: "prod-1" });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      id: "prod-1",
      name: "Hat",
      description: "A hat.",
      imageUrl: "https://img/hat.jpg",
      options: [{ name: "Size", choices: ["S", "M"] }],
      variants: [{ id: "v-1", sku: "HAT-S", price: "25.00", inStock: true }],
    });
    expect(res.data.seoData).toBeUndefined();
    expect(res.data.media).toBeUndefined();
  });

  it("wix_get_product points at search when the id is unknown", async () => {
    mockFetch([{ method: "GET", path: "/stores/v3/products/nope", reply: () => ({}) }]);
    const res = await server.call("wix_get_product", { product_id: "nope" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not found.*wix_search_products/);
  });
});
