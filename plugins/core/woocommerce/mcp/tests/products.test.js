import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerProductTools } = require("../tools/products");
const { registerStoreTools } = require("../tools/store");

process.env.WORDPRESS_SITE_URL = "https://store.test";
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs";

const WC = "/wp-json/wc/v3";
const HAT = {
  id: 5,
  name: "Hat",
  sku: "HAT",
  type: "variable",
  status: "publish",
  price: "20",
  regular_price: "20",
  sale_price: "",
  on_sale: false,
  stock_status: "instock",
  stock_quantity: null,
  permalink: "https://store.test/hat",
  categories: [{ name: "Hats" }],
  short_description: "A hat",
  attributes: [{ name: "Size", options: ["S", "M"] }],
};
const HAT_M = {
  id: 51,
  name: "Hat - M",
  sku: "HAT-M",
  type: "variation",
  status: "publish",
  price: "20",
  regular_price: "20",
  stock_status: "outofstock",
  stock_quantity: 0,
  parent_id: 5,
  attributes: [{ name: "Size", option: "M" }],
  backorders: "no",
};

describe("product + store tools", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerProductTools(server);
    registerStoreTools(server);
  });

  it("woocommerce_search_products returns compact published products", async () => {
    const { calls } = mockFetch([{ method: "GET", path: `${WC}/products`, reply: () => [HAT] }]);
    const res = await server.call("woocommerce_search_products", { query: "hat", limit: 300 });
    expect(res.data.items).toEqual([
      expect.objectContaining({ id: 5, name: "Hat", stockStatus: "instock" }),
    ]);
    expect(calls[0].query.get("status")).toBe("publish");
    expect(calls[0].query.get("per_page")).toBe("100");
  });

  it("woocommerce_get_product loads variations for variable products", async () => {
    const { calls } = mockFetch([
      { method: "GET", path: `${WC}/products/5`, reply: () => HAT },
      { method: "GET", path: `${WC}/products/5/variations`, reply: () => [HAT_M] },
    ]);
    const res = await server.call("woocommerce_get_product", { product_id: "5" });
    expect(res.data).toMatchObject({ id: 5, description: "A hat", categories: ["Hats"] });
    expect(res.data.variations).toEqual([
      expect.objectContaining({
        id: 51,
        sku: "HAT-M",
        stockStatus: "outofstock",
        attributes: [{ name: "Size", option: "M" }],
      }),
    ]);
    expect(calls).toHaveLength(2);
  });

  it("woocommerce_get_product reports unknown ids", async () => {
    mockFetch([
      {
        method: "GET",
        path: `${WC}/products/9`,
        reply: () => ({
          status: 404,
          body: { code: "woocommerce_rest_product_invalid_id", message: "Invalid ID." },
        }),
      },
    ]);
    expect((await server.call("woocommerce_get_product", { product_id: "9" })).text).toMatch(
      /Product 9 not found/,
    );
  });

  it("woocommerce_check_inventory matches a variation SKU case-insensitively", async () => {
    mockFetch([
      {
        method: "GET",
        path: `${WC}/products`,
        reply: ({ query }) => (query.get("sku") === "hat-m" ? [HAT_M] : []),
      },
    ]);
    const res = await server.call("woocommerce_check_inventory", { sku: "hat-m" });
    expect(res.data).toMatchObject({
      found: true,
      sku: "HAT-M",
      inStock: false,
      stockQuantity: 0,
      backorders: "no",
    });
    expect((await server.call("woocommerce_check_inventory", { sku: "nope" })).data.found).toBe(
      false,
    );
  });

  it("woocommerce_get_store summarises the system status", async () => {
    mockFetch([
      {
        method: "GET",
        path: `${WC}/system_status`,
        reply: () => ({
          environment: {
            site_url: "https://store.test",
            wp_version: "6.7",
            version: "9.5.0",
            default_timezone: "Europe/Lisbon",
          },
          settings: { currency: "EUR", currency_symbol: "€", taxes_enabled: true },
        }),
      },
    ]);
    const res = await server.call("woocommerce_get_store", {});
    expect(res.data).toEqual({
      siteUrl: "https://store.test",
      wordpressVersion: "6.7",
      wooCommerceVersion: "9.5.0",
      currency: "EUR",
      currencySymbol: "€",
      taxesEnabled: true,
      timezone: "Europe/Lisbon",
    });
  });
});
