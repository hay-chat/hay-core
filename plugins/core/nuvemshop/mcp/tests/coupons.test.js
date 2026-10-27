import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BASE, makeOrder, orderRoutes } = require("./fixtures");
const { createFakeServer, mockFetch } = require("./harness");
const { registerCouponTools, couponPolicy } = require("../tools/coupons");

const ENV = [
  "NUVEMSHOP_COUPONS_ENABLED",
  "NUVEMSHOP_COUPON_MAX_PERCENT",
  "NUVEMSHOP_COUPON_MAX_AMOUNT",
  "NUVEMSHOP_COUPON_MAX_DAYS",
];

let server;
beforeEach(() => {
  server = createFakeServer();
  registerCouponTools(server);
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

const couponRoute = () => ({
  method: "POST",
  path: `${BASE}/coupons`,
  reply: ({ body }) => ({ id: 55, ...body }),
});

describe("couponPolicy", () => {
  it("defaults to enabled, 10%, no fixed amount, 30 days", () => {
    expect(couponPolicy()).toEqual({ enabled: true, maxPercent: 10, maxAmount: 0, maxDays: 30 });
    process.env.NUVEMSHOP_COUPON_MAX_PERCENT = "250";
    process.env.NUVEMSHOP_COUPON_MAX_DAYS = "9999";
    expect(couponPolicy()).toMatchObject({ maxPercent: 100, maxDays: 365 });
  });
});

describe("nuvemshop_create_coupon", () => {
  it("creates a single-use, non-combinable coupon with a generated code", async () => {
    const { calls } = mockFetch([couponRoute()]);
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 10,
      reason: "late parcel",
    });
    expect(res.isError).toBe(false);
    const post = calls.find((c) => c.method === "POST");
    expect(post.body).toMatchObject({
      type: "percentage",
      value: "10.00",
      max_uses: 1,
      combines_with_other_discounts: false,
      includes_shipping: false,
      valid: true,
    });
    expect(post.body.code).toMatch(/^HAY[A-Z2-9]{8}$/);
    const days = (Date.parse(post.body.end_date) - Date.parse(post.body.start_date)) / 86400000;
    expect(days).toBe(30);
    expect(res.data).toMatchObject({ created: true, code: post.body.code, maxUses: 1 });
  });

  it("refuses above the cap without calling the API", async () => {
    const { calls } = mockFetch([couponRoute()]);
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 15,
      reason: "late",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/above the merchant's cap of 10%/);
    expect(calls).toHaveLength(0);
  });

  it("fixed amounts are off until the merchant sets a fixed cap, then capped", async () => {
    mockFetch([couponRoute()]);
    let res = await server.call("nuvemshop_create_coupon", {
      type: "absolute",
      value: 5,
      reason: "late",
    });
    expect(res.text).toMatch(/Fixed-amount coupons are not enabled/);

    process.env.NUVEMSHOP_COUPON_MAX_AMOUNT = "25";
    res = await server.call("nuvemshop_create_coupon", {
      type: "absolute",
      value: 30,
      reason: "late",
    });
    expect(res.text).toMatch(/above the merchant's cap of 25/);
    res = await server.call("nuvemshop_create_coupon", {
      type: "absolute",
      value: 25,
      reason: "late",
    });
    expect(res.data.value).toBe("25.00");
  });

  it("refuses when coupons are turned off", async () => {
    process.env.NUVEMSHOP_COUPONS_ENABLED = "false";
    const { calls } = mockFetch([couponRoute()]);
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
    });
    expect(res.text).toMatch(/turned off/);
    expect(calls).toHaveLength(0);
  });

  it("caps valid_days at the merchant's maximum", async () => {
    process.env.NUVEMSHOP_COUPON_MAX_DAYS = "7";
    const { calls } = mockFetch([couponRoute()]);
    await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      valid_days: 60,
    });
    const post = calls.find((c) => c.method === "POST");
    expect((Date.parse(post.body.end_date) - Date.parse(post.body.start_date)) / 86400000).toBe(7);
  });

  it("records the coupon on the order and allows only one per order", async () => {
    const order = makeOrder();
    const { calls } = mockFetch(
      orderRoutes(order, {
        extra: [
          couponRoute(),
          {
            method: "PUT",
            path: `${BASE}/orders/900`,
            reply: ({ body }) => ({ ...order, ...body }),
          },
        ],
      }),
    );
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      order_number: "101",
    });
    expect(res.data.ownerNote).toMatch(/HAY COUPON HAY[A-Z2-9]{8}: 5% off, single use/);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);

    const again = makeOrder({ owner_note: res.data.ownerNote });
    const second = mockFetch(orderRoutes(again, { extra: [couponRoute()] }));
    const res2 = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      order_id: "900",
    });
    expect(res2.text).toMatch(/already received a Hay goodwill coupon/);
    expect(second.calls.some((c) => c.method === "POST")).toBe(false);
  });
});
