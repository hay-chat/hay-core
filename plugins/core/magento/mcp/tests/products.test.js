import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerProductTools } = require("../tools/products");
const { registerStoreTools } = require("../tools/store");

process.env.MAGENTO_BASE_URL = "https://store.test/rest/V1";
process.env.MAGENTO_API_TOKEN = "tok";

const V1 = "/rest/V1";
const HAT = {
  id: 5,
  sku: "HAT",
  name: "Hat",
  type_id: "configurable",
  status: 1,
  price: 20,
  custom_attributes: [
    { attribute_code: "url_key", value: "hat" },
    { attribute_code: "short_description", value: "A hat" },
  ],
};
const HAT_M = {
  id: 6,
  sku: "HAT-M",
  name: "Hat M",
  type_id: "simple",
  status: 1,
  price: 20,
  custom_attributes: [],
};
const notFound = () => ({
  status: 404,
  body: {
    message: "The product that was requested doesn't exist. Verify the product and try again.",
  },
});

describe("product + store tools", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerProductTools(server);
    registerStoreTools(server);
  });

  it("magento_search_products filters enabled products by name like", async () => {
    const { calls } = mockFetch([
      { method: "GET", path: `${V1}/products`, reply: () => ({ items: [HAT], total_count: 1 }) },
    ]);
    const res = await server.call("magento_search_products", { query: "hat", limit: 500 });
    expect(res.data).toEqual({
      items: [expect.objectContaining({ sku: "HAT", status: "enabled", urlKey: "hat" })],
      page: 1,
      totalPages: 1,
      total: 1,
    });
    const q = calls[0].query;
    expect(q.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe("%hat%");
    expect(q.get("searchCriteria[filter_groups][0][filters][0][condition_type]")).toBe("like");
    expect(q.get("searchCriteria[filter_groups][1][filters][0][field]")).toBe("status");
    expect(q.get("searchCriteria[pageSize]")).toBe("100");
  });

  it("magento_get_product merges stock and configurable children", async () => {
    mockFetch([
      { method: "GET", path: `${V1}/products/HAT`, reply: () => HAT },
      {
        method: "GET",
        path: `${V1}/stockItems/HAT`,
        reply: () => ({ is_in_stock: true, qty: 0, manage_stock: false }),
      },
      { method: "GET", path: `${V1}/configurable-products/HAT/children`, reply: () => [HAT_M] },
      {
        method: "GET",
        path: `${V1}/stockItems/HAT-M`,
        reply: () => ({ is_in_stock: false, qty: 0, manage_stock: true, backorders: 0 }),
      },
    ]);
    const res = await server.call("magento_get_product", { sku: "HAT" });
    expect(res.data).toMatchObject({
      sku: "HAT",
      description: "A hat",
      stock: { inStock: true, manageStock: false },
    });
    expect(res.data.variants).toEqual([
      expect.objectContaining({
        sku: "HAT-M",
        stock: { inStock: false, quantity: 0, manageStock: true, backorders: 0 },
      }),
    ]);
  });

  it("magento_get_product and magento_check_inventory report unknown SKUs", async () => {
    mockFetch([
      { method: "GET", path: `${V1}/products/NOPE`, reply: notFound },
      { method: "GET", path: `${V1}/stockItems/NOPE`, reply: notFound },
    ]);
    expect((await server.call("magento_get_product", { sku: "NOPE" })).text).toMatch(
      /Product "NOPE" not found/,
    );
    expect((await server.call("magento_check_inventory", { sku: "NOPE" })).data.found).toBe(false);
  });

  it("magento_check_inventory returns the stock item", async () => {
    mockFetch([
      {
        method: "GET",
        path: `${V1}/stockItems/HAT-M`,
        reply: () => ({ is_in_stock: true, qty: 3, manage_stock: true, backorders: 0 }),
      },
    ]);
    expect((await server.call("magento_check_inventory", { sku: "HAT-M" })).data).toEqual({
      found: true,
      sku: "HAT-M",
      inStock: true,
      quantity: 3,
      manageStock: true,
      backorders: 0,
    });
  });

  it("magento_get_store summarises the first store config", async () => {
    mockFetch([
      {
        method: "GET",
        path: `${V1}/store/storeConfigs`,
        reply: () => [
          {
            code: "default",
            website_id: 1,
            base_url: "https://store.test/",
            locale: "pt_PT",
            base_currency_code: "EUR",
            default_display_currency_code: "EUR",
            timezone: "Europe/Lisbon",
            weight_unit: "kgs",
          },
        ],
      },
    ]);
    expect((await server.call("magento_get_store", {})).data).toEqual({
      storeCode: "default",
      websiteId: 1,
      baseUrl: "https://store.test/",
      locale: "pt_PT",
      currency: "EUR",
      displayCurrency: "EUR",
      timezone: "Europe/Lisbon",
      weightUnit: "kgs",
    });
  });
});
