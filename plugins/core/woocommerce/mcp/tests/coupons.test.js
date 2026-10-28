import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerCouponTools, couponPolicy } = require("../tools/coupons");

process.env.WORDPRESS_SITE_URL = "https://store.test/";
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs";

const API = "/wp-json/wc/v3";
const ENV = [
  "WOOCOMMERCE_COUPONS_ENABLED",
  "WOOCOMMERCE_COUPON_MAX_PERCENT",
  "WOOCOMMERCE_COUPON_MAX_AMOUNT",
  "WOOCOMMERCE_COUPON_MAX_DAYS",
];

const ORDER = {
  id: 12,
  number: "12",
  status: "completed",
  currency: "EUR",
  billing: { email: "Ana@Example.com" },
};

/** A coupon as WooCommerce returns it (codes and emails come back lowercased). */
const goodwill = (overrides = {}) => ({
  id: 40,
  code: "hayabcdefgh",
  email_restrictions: ["ana@example.com"],
  usage_limit: 1,
  usage_count: 0,
  date_expires_gmt: "2099-01-01T00:00:00",
  meta_data: [{ key: "_hay_goodwill", value: "late" }],
  ...overrides,
});

function routes({ existing = [], order = ORDER } = {}) {
  return [
    { method: "GET", path: `${API}/coupons`, reply: () => existing },
    {
      method: "POST",
      path: `${API}/coupons`,
      reply: ({ body }) => ({ id: 77, ...body, code: body.code.toLowerCase() }),
    },
    { method: "GET", path: `${API}/orders/${order.id}`, reply: () => order },
    {
      method: "POST",
      path: `${API}/orders/${order.id}/notes`,
      reply: ({ body }) => ({ id: 5, ...body }),
    },
  ];
}

const BASE_ARGS = {
  email: "ana@example.com",
  type: "percentage",
  value: 10,
  reason: "late parcel",
};
const posts = (calls) => calls.filter((c) => c.method === "POST" && c.path === `${API}/coupons`);

let server;
beforeEach(() => {
  server = createFakeServer();
  registerCouponTools(server);
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

describe("couponPolicy", () => {
  it("defaults to enabled, 10%, fixed amounts off, 30 days", () => {
    expect(couponPolicy()).toEqual({ enabled: true, maxPercent: 10, maxAmount: 0, maxDays: 30 });
  });
});

describe("woocommerce_create_coupon", () => {
  it("creates a single-use coupon restricted to the customer's email", async () => {
    const { calls } = mockFetch(routes());
    const res = await server.call("woocommerce_create_coupon", BASE_ARGS);
    expect(res.isError).toBe(false);
    const [post] = posts(calls);
    expect(post.body).toMatchObject({
      discount_type: "percent",
      amount: "10.00",
      individual_use: true,
      usage_limit: 1,
      usage_limit_per_user: 1,
      email_restrictions: ["ana@example.com"],
      free_shipping: false,
      meta_data: [{ key: "_hay_goodwill", value: "late parcel" }],
    });
    expect(post.body.code).toMatch(/^HAY[A-Z2-9]{8}$/);
    const days = (Date.parse(`${post.body.date_expires}Z`) - Date.now()) / 86400000;
    expect(Math.round(days)).toBe(30);
    expect(res.data).toMatchObject({
      created: true,
      code: post.body.code,
      usageLimit: 1,
      restrictedToEmail: "ana@example.com",
    });
  });

  it("refuses above the cap with NEEDS_APPROVAL and creates nothing", async () => {
    const { calls } = mockFetch(routes());
    const res = await server.call("woocommerce_create_coupon", { ...BASE_ARGS, value: 25 });
    expect(res.error).toMatchObject({
      code: "NEEDS_APPROVAL",
      details: { type: "percentage", requested: 25, cap: 10 },
    });
    expect(res.text).not.toMatch(/held|pending/i);
    expect(calls).toHaveLength(0);
  });

  it("creates an over-cap coupon on the approved retry, other bounds intact", async () => {
    const { calls } = mockFetch(routes());
    const res = await server.call("woocommerce_create_coupon", {
      ...BASE_ARGS,
      value: 25,
      hay_approval_id: "pa-1",
    });
    expect(res.isError).toBe(false);
    expect(posts(calls)[0].body).toMatchObject({ amount: "25.00", usage_limit: 1 });
  });

  it("fixed amounts are off by default and capped once the merchant sets a ceiling", async () => {
    mockFetch(routes());
    let res = await server.call("woocommerce_create_coupon", { ...BASE_ARGS, type: "absolute" });
    expect(res.error).toMatchObject({ code: "PRECONDITION" });
    expect(res.text).toMatch(/Fixed-amount coupons are turned off/);

    process.env.WOOCOMMERCE_COUPON_MAX_AMOUNT = "15";
    res = await server.call("woocommerce_create_coupon", {
      ...BASE_ARGS,
      type: "absolute",
      value: 20,
    });
    expect(res.error).toMatchObject({ code: "NEEDS_APPROVAL", details: { amount: 20, cap: 15 } });

    const { calls } = mockFetch(routes());
    res = await server.call("woocommerce_create_coupon", {
      ...BASE_ARGS,
      type: "absolute",
      value: 15,
    });
    expect(posts(calls)[0].body).toMatchObject({ discount_type: "fixed_cart", amount: "15.00" });
  });

  it("refuses when the merchant turned coupons off, even when approved", async () => {
    process.env.WOOCOMMERCE_COUPONS_ENABLED = "false";
    const { calls } = mockFetch(routes());
    const res = await server.call("woocommerce_create_coupon", {
      ...BASE_ARGS,
      hay_approval_id: "pa-1",
    });
    expect(res.error).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "COUPONS_DISABLED" },
    });
    expect(calls).toHaveLength(0);
  });

  it("caps valid_days at the merchant's maximum", async () => {
    process.env.WOOCOMMERCE_COUPON_MAX_DAYS = "7";
    const { calls } = mockFetch(routes());
    await server.call("woocommerce_create_coupon", { ...BASE_ARGS, valid_days: 90 });
    const days = (Date.parse(`${posts(calls)[0].body.date_expires}Z`) - Date.now()) / 86400000;
    expect(Math.round(days)).toBe(7);
  });

  it("allows one active goodwill coupon per email, approved or not", async () => {
    const { calls } = mockFetch(routes({ existing: [goodwill()] }));
    const res = await server.call("woocommerce_create_coupon", {
      ...BASE_ARGS,
      email: "ANA@example.com",
      hay_approval_id: "pa-1",
    });
    expect(res.error).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "ALREADY_HAS_COUPON", code: "HAYABCDEFGH" },
    });
    expect(posts(calls)).toHaveLength(0);
  });

  it("ignores used, expired, other customers' and non-Hay.chat coupons", async () => {
    const { calls } = mockFetch(
      routes({
        existing: [
          goodwill({ usage_count: 1 }),
          goodwill({ date_expires_gmt: "2020-01-01T00:00:00" }),
          goodwill({ email_restrictions: ["other@example.com"] }),
          goodwill({ meta_data: [] }),
          goodwill({ code: "summer10" }),
        ],
      }),
    );
    const res = await server.call("woocommerce_create_coupon", BASE_ARGS);
    expect(res.isError).toBe(false);
    expect(posts(calls)).toHaveLength(1);
  });

  it("pages through every HAY coupon to find an earlier one", async () => {
    const other = goodwill({ email_restrictions: ["bob@example.com"] });
    const { calls } = mockFetch([
      {
        method: "GET",
        path: `${API}/coupons`,
        reply: ({ query }) =>
          query.get("page") === "1" ? Array.from({ length: 100 }, () => other) : [goodwill()],
      },
      ...routes().slice(1),
    ]);
    const res = await server.call("woocommerce_create_coupon", BASE_ARGS);
    expect(res.error).toMatchObject({ details: { reason: "ALREADY_HAS_COUPON" } });
    const pages = calls.filter((c) => c.method === "GET" && c.path === `${API}/coupons`);
    expect(pages.map((c) => c.query.get("page"))).toEqual(["1", "2"]);
    expect(posts(calls)).toHaveLength(0);
  });

  it("fails closed when there are too many HAY coupons to check", async () => {
    const other = goodwill({ email_restrictions: ["bob@example.com"] });
    const { calls } = mockFetch([
      {
        method: "GET",
        path: `${API}/coupons`,
        reply: () => Array.from({ length: 100 }, () => other),
      },
      ...routes().slice(1),
    ]);
    const res = await server.call("woocommerce_create_coupon", BASE_ARGS);
    expect(res.error).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "GOODWILL_CHECK_INCOMPLETE" },
    });
    expect(posts(calls)).toHaveLength(0);
  });

  it("ties the coupon to an order of the same customer and notes it privately", async () => {
    const { calls } = mockFetch(routes());
    const res = await server.call("woocommerce_create_coupon", { ...BASE_ARGS, order_id: "12" });
    expect(res.data.orderNumber).toBe("12");
    const note = calls.find((c) => c.path === `${API}/orders/12/notes`);
    expect(note.body.customer_note).toBe(false);
    expect(note.body.note).toMatch(/^\[Hay\.chat\] Goodwill coupon HAY[A-Z2-9]{8}: 10\.00% off/);
  });

  it("refuses an order placed with another email", async () => {
    const { calls } = mockFetch(routes());
    const res = await server.call("woocommerce_create_coupon", {
      ...BASE_ARGS,
      email: "mallory@example.com",
      order_id: "12",
    });
    expect(res.error).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "EMAIL_MISMATCH" },
    });
    expect(posts(calls)).toHaveLength(0);
  });

  it("rejects a malformed email", async () => {
    const { calls } = mockFetch(routes());
    const res = await server.call("woocommerce_create_coupon", { ...BASE_ARGS, email: "ana" });
    expect(res.error).toMatchObject({ code: "BAD_INPUT" });
    expect(calls).toHaveLength(0);
  });
});
