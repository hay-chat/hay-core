/**
 * D16-7 parity tools: customer profile/address updates, product by slug or
 * URL, and the read-only refund preview.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerCustomerTools } = require("../tools/customers");
const { registerProductTools, slugFrom } = require("../tools/products");
const { registerRefundTools } = require("../tools/refunds");

process.env.WORDPRESS_SITE_URL = "https://store.test";
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs";

const WC = "/wp-json/wc/v3";
const ANA = {
  id: 7,
  email: "ana@example.com",
  first_name: "Ana",
  last_name: "Silva",
  billing: { phone: "111", city: "Recife", address_1: "Rua A 1" },
  shipping: { city: "Recife", address_1: "Rua A 1", postcode: "50000-000" },
};

let server;
beforeEach(() => {
  server = createFakeServer();
  registerCustomerTools(server);
  registerProductTools(server);
  registerRefundTools(server);
});

describe("woocommerce_update_customer", () => {
  it("updates name and phone on the account found by email", async () => {
    const { calls } = mockFetch([
      { path: `${WC}/customers`, reply: () => [ANA] },
      {
        method: "PUT",
        path: `${WC}/customers/7`,
        reply: ({ body }) => ({ ...ANA, ...body, billing: { ...ANA.billing, ...body.billing } }),
      },
    ]);
    const res = await server.call("woocommerce_update_customer", {
      email: "ANA@example.com",
      last_name: "Souza",
      phone: "+55 81 99999-0000",
    });
    expect(res.isError).toBe(false);
    const put = calls.find((c) => c.method === "PUT");
    expect(put.body).toEqual({ last_name: "Souza", billing: { phone: "+55 81 99999-0000" } });
    expect(res.data.customer).toMatchObject({ lastName: "Souza", phone: "+55 81 99999-0000" });
  });

  it("refuses guests (no account) and empty updates without writing", async () => {
    const { calls } = mockFetch([{ path: `${WC}/customers`, reply: () => [] }]);
    const guest = await server.call("woocommerce_update_customer", {
      email: "guest@example.com",
      first_name: "G",
    });
    expect(guest.error).toMatchObject({ code: "PRECONDITION", details: { reason: "NO_ACCOUNT" } });
    const empty = await server.call("woocommerce_update_customer", { email: "ana@example.com" });
    expect(empty.error.code).toBe("BAD_INPUT");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("does not accept an email change", async () => {
    mockFetch([{ path: `${WC}/customers`, reply: () => [ANA] }]);
    await expect(
      server.call("woocommerce_update_customer", { email: "ana@example.com", new_email: "x@y.z" }),
    ).resolves.toMatchObject({ isError: true });
  });
});

describe("woocommerce_update_customer_address", () => {
  it("merges only the passed fields into the chosen saved address", async () => {
    const { calls } = mockFetch([
      { path: `${WC}/customers`, reply: () => [ANA] },
      { method: "PUT", path: `${WC}/customers/7`, reply: ({ body }) => ({ ...ANA, ...body }) },
    ]);
    const res = await server.call("woocommerce_update_customer_address", {
      email: "ana@example.com",
      address_type: "shipping",
      address: { address_1: "Rua B 2", postcode: "50100-000" },
    });
    expect(calls.find((c) => c.method === "PUT").body).toEqual({
      shipping: { city: "Recife", address_1: "Rua B 2", postcode: "50100-000" },
    });
    expect(res.data).toMatchObject({ updated: true, addressType: "shipping", customerId: 7 });
  });

  it("refuses an empty address", async () => {
    mockFetch([{ path: `${WC}/customers`, reply: () => [ANA] }]);
    const res = await server.call("woocommerce_update_customer_address", {
      email: "ana@example.com",
      address_type: "billing",
      address: {},
    });
    expect(res.error.code).toBe("BAD_INPUT");
  });
});

describe("woocommerce_get_product_by_slug", () => {
  it("reads the slug from a pasted storefront URL, a ?product= link or a bare slug", () => {
    expect(slugFrom("https://store.test/product/blue-shirt/")).toBe("blue-shirt");
    expect(slugFrom("https://store.test/?product=blue-shirt")).toBe("blue-shirt");
    expect(slugFrom("store.test/product/caf%C3%A9-mug")).toBe("café-mug");
    expect(slugFrom("blue-shirt")).toBe("blue-shirt");
    expect(slugFrom("%E0%A4%A")).toBe("");
  });

  it("finds the product by slug and returns the full product view", async () => {
    const { calls } = mockFetch([
      {
        path: `${WC}/products`,
        reply: ({ query }) =>
          query.get("slug") === "blue-shirt"
            ? [{ id: 9, name: "Blue Shirt", type: "simple", price: "10", stock_status: "instock" }]
            : [],
      },
    ]);
    const res = await server.call("woocommerce_get_product_by_slug", {
      slug_or_url: "https://store.test/product/blue-shirt/",
    });
    expect(res.data).toMatchObject({ id: 9, name: "Blue Shirt", variations: [] });
    expect(calls[0].query.get("slug")).toBe("blue-shirt");

    const missing = await server.call("woocommerce_get_product_by_slug", { slug_or_url: "nope" });
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});

describe("woocommerce_calculate_refund", () => {
  const ORDER = {
    id: 12,
    number: "12",
    status: "completed",
    currency: "EUR",
    date_paid: "2026-10-01T10:01:00",
    total: "60.00",
    payment_method_title: "Card (Stripe)",
    line_items: [
      { id: 101, name: "Hat", quantity: 2, total: "40.00", taxes: [{ id: 1, total: "8.00" }] },
    ],
    refunds: [{ id: 1, total: "-10.00" }],
  };

  it("previews an item refund without posting anything", async () => {
    const { calls } = mockFetch([{ path: `${WC}/orders/12`, reply: () => ORDER }]);
    const res = await server.call("woocommerce_calculate_refund", {
      order_id: "12",
      line_items: [{ line_item_id: "101", quantity: 1 }],
    });
    expect(res.data).toMatchObject({
      amount: { amount: "24.00", currency: "EUR" },
      remainingRefundableBefore: { amount: "50.00" },
      remainingRefundableAfter: { amount: "26.00" },
      lineItems: [{ id: 101, quantity: 1, refundTotal: 20, refundTax: 4 }],
    });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("applies the same refusals as the real refund", async () => {
    mockFetch([{ path: `${WC}/orders/12`, reply: () => ORDER }]);
    const res = await server.call("woocommerce_calculate_refund", {
      order_id: "12",
      amount: "80",
    });
    expect(res.error).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "EXCEEDS_REFUNDABLE" },
    });
  });
});
