import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BASE } = require("./fixtures");
const { createFakeServer, mockFetch } = require("./harness");
const { registerProductTools, variantStock } = require("../tools/products");
const { registerStoreTools } = require("../tools/store");

let server;
beforeEach(() => {
  server = createFakeServer();
  registerProductTools(server);
  registerStoreTools(server);
});

const PRODUCT = {
  id: 5,
  name: { pt: "Camiseta", es: "Remera" },
  handle: { pt: "camiseta" },
  description: { pt: "<p>Algodão <b>orgânico</b></p>" },
  published: true,
  attributes: [{ pt: "Tamanho" }],
  categories: [{ id: 3, name: { pt: "Roupas" } }],
  images: [{ src: "https://img.test/1.jpg" }],
  variants: [
    {
      id: 50,
      sku: "CAM-P",
      values: [{ pt: "P" }],
      price: "50.00",
      stock_management: true,
      stock: 0,
    },
    {
      id: 51,
      sku: "CAM-M",
      values: [{ pt: "M" }],
      price: "50.00",
      stock_management: true,
      stock: null,
      inventory_levels: [
        { location_id: "a", stock: 2 },
        { location_id: "b", stock: 3 },
      ],
    },
    {
      id: 52,
      sku: "CAM-G",
      values: [{ pt: "G" }],
      price: "55.00",
      stock_management: false,
      stock: null,
    },
  ],
};

describe("variantStock", () => {
  it("reads legacy stock, sums inventory levels, and treats null as unlimited", () => {
    expect(variantStock(PRODUCT.variants[0])).toBe(0);
    expect(variantStock(PRODUCT.variants[1])).toBe(5);
    expect(variantStock({ inventory_levels: [{ stock: 1 }, { stock: null }] })).toBeNull();
  });
});

describe("nuvemshop_check_inventory", () => {
  it("returns the matching variant's stock", async () => {
    mockFetch([{ method: "GET", path: `${BASE}/products/sku/CAM-M`, reply: () => PRODUCT }]);
    const res = await server.call("nuvemshop_check_inventory", { sku: "CAM-M" });
    expect(res.data).toMatchObject({
      found: true,
      sku: "CAM-M",
      stockQuantity: 5,
      inStock: true,
      stockTracked: true,
      product: { id: 5, name: "Camiseta" },
    });
    expect(res.data.locations).toEqual([
      { locationId: "a", stock: 2 },
      { locationId: "b", stock: 3 },
    ]);
  });

  it("reports out of stock, untracked stock and unknown SKUs", async () => {
    mockFetch([
      { method: "GET", path: `${BASE}/products/sku/CAM-P`, reply: () => PRODUCT },
      { method: "GET", path: `${BASE}/products/sku/CAM-G`, reply: () => PRODUCT },
    ]);
    expect((await server.call("nuvemshop_check_inventory", { sku: "CAM-P" })).data).toMatchObject({
      inStock: false,
      stockQuantity: 0,
    });
    expect((await server.call("nuvemshop_check_inventory", { sku: "CAM-G" })).data).toMatchObject({
      inStock: true,
      stockTracked: false,
      stockQuantity: null,
    });
    expect((await server.call("nuvemshop_check_inventory", { sku: "NOPE" })).data).toMatchObject({
      found: false,
    });
  });
});

describe("nuvemshop_search_products / get_product", () => {
  it("searches published products and flattens i18n", async () => {
    const { calls } = mockFetch([
      { method: "GET", path: `${BASE}/products`, reply: () => [PRODUCT] },
    ]);
    const res = await server.call("nuvemshop_search_products", {
      query: "camiseta",
      language: "es",
    });
    expect(calls[0].query.get("published")).toBe("true");
    expect(calls[0].query.get("per_page")).toBe("10");
    expect(res.data.items[0]).toMatchObject({
      id: 5,
      name: "Remera",
      inStock: true,
      variantCount: 3,
    });
  });

  it("gets a product with plain-text description and variants", async () => {
    mockFetch([{ method: "GET", path: `${BASE}/products/5`, reply: () => PRODUCT }]);
    const res = await server.call("nuvemshop_get_product", { product_id: "5" });
    expect(res.data.description).toBe("Algodão orgânico");
    expect(res.data.categories).toEqual([{ id: 3, name: "Roupas" }]);
    expect(res.data.variants.map((v) => v.options[0])).toEqual(["P", "M", "G"]);
  });
});

describe("nuvemshop_get_store", () => {
  it("projects store facts", async () => {
    mockFetch([
      {
        method: "GET",
        path: `${BASE}/store`,
        reply: () => ({
          id: 1,
          name: { pt: "Loja" },
          original_domain: "loja.lojavirtualnuvem.com.br",
          main_currency: "BRL",
          languages: { pt: {}, es: {} },
          country: "BR",
        }),
      },
    ]);
    const res = await server.call("nuvemshop_get_store", {});
    expect(res.data).toMatchObject({
      name: "Loja",
      url: "https://loja.lojavirtualnuvem.com.br",
      mainCurrency: "BRL",
      languages: ["pt", "es"],
    });
  });
});
