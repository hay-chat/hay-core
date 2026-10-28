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

const ORDER_ARGS = { order_number: "101", email: "Ana@Example.com" };

/** Order lookup + note write + coupon POST, as one successful create needs. */
function storeRoutes(order = makeOrder()) {
  return orderRoutes(order, {
    extra: [
      couponRoute(),
      {
        method: "PUT",
        path: `${BASE}/orders/${order.id}`,
        reply: ({ body }) => ({ ...order, ...body }),
      },
    ],
  });
}

describe("nuvemshop_create_coupon", () => {
  it("creates a single-use, non-combinable coupon with a generated code", async () => {
    const { calls } = mockFetch(storeRoutes());
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 10,
      reason: "late parcel",
      ...ORDER_ARGS,
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

  it("refuses above the cap with NEEDS_APPROVAL, without calling the API", async () => {
    const { calls } = mockFetch(storeRoutes());
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 15,
      reason: "late",
      ...ORDER_ARGS,
    });
    expect(res.isError).toBe(true);
    expect(res.error).toMatchObject({
      code: "NEEDS_APPROVAL",
      details: { type: "percentage", requested: 15, cap: 10 },
    });
    expect(res.text).toMatch(/above the merchant's cap of 10%/);
    expect(res.text).not.toMatch(/held|pending/i);
    expect(calls).toHaveLength(0);
  });

  it("creates an over-cap coupon once a person approved it (hay_approval_id)", async () => {
    const { calls } = mockFetch(storeRoutes());
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 15,
      reason: "late",
      hay_approval_id: "pa-1",
      ...ORDER_ARGS,
    });
    expect(res.isError).toBe(false);
    expect(calls.find((c) => c.method === "POST").body).toMatchObject({ value: "15.00", max_uses: 1 });
    expect(res.data.ownerNote).toMatch(/approved by a team member/);
  });

  it("fixed amounts are off until the merchant sets a fixed cap, then capped", async () => {
    mockFetch(storeRoutes());
    let res = await server.call("nuvemshop_create_coupon", {
      type: "absolute",
      value: 5,
      reason: "late",
      ...ORDER_ARGS,
    });
    expect(res.error).toMatchObject({ code: "PRECONDITION" });
    expect(res.text).toMatch(/Fixed-amount coupons are turned off/);

    process.env.NUVEMSHOP_COUPON_MAX_AMOUNT = "25";
    res = await server.call("nuvemshop_create_coupon", {
      type: "absolute",
      value: 30,
      reason: "late",
      ...ORDER_ARGS,
    });
    expect(res.error).toMatchObject({ code: "NEEDS_APPROVAL", details: { amount: 30, cap: 25 } });
    res = await server.call("nuvemshop_create_coupon", {
      type: "absolute",
      value: 25,
      reason: "late",
      ...ORDER_ARGS,
    });
    expect(res.data.value).toBe("25.00");
  });

  it("refuses when coupons are turned off, even when approved", async () => {
    process.env.NUVEMSHOP_COUPONS_ENABLED = "false";
    const { calls } = mockFetch(storeRoutes());
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      hay_approval_id: "pa-1",
      ...ORDER_ARGS,
    });
    expect(res.text).toMatch(/turned off/);
    expect(calls).toHaveLength(0);
  });

  it("requires the order the coupon compensates", async () => {
    const { calls } = mockFetch(storeRoutes());
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      email: "ana@example.com",
    });
    expect(res.error).toMatchObject({ code: "BAD_INPUT" });
    expect(calls).toHaveLength(0);
  });

  it("caps valid_days at the merchant's maximum", async () => {
    process.env.NUVEMSHOP_COUPON_MAX_DAYS = "7";
    const { calls } = mockFetch(storeRoutes());
    await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      valid_days: 60,
      ...ORDER_ARGS,
    });
    const post = calls.find((c) => c.method === "POST");
    expect((Date.parse(post.body.end_date) - Date.parse(post.body.start_date)) / 86400000).toBe(7);
  });

  it("records the coupon on the order and allows only one per order, approved or not", async () => {
    const { calls } = mockFetch(storeRoutes());
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      ...ORDER_ARGS,
    });
    expect(res.data.ownerNote).toMatch(/HAY COUPON HAY[A-Z2-9]{8}: 5% off, single use/);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);

    const again = makeOrder({ owner_note: res.data.ownerNote });
    const second = mockFetch(storeRoutes(again));
    const res2 = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      order_id: String(again.id),
      email: "ana@example.com",
      hay_approval_id: "pa-2",
    });
    expect(res2.text).toMatch(/already received a Hay.chat goodwill coupon/);
    expect(second.calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("refuses when the email does not match the order's customer", async () => {
    const { calls } = mockFetch(storeRoutes());
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      order_number: "101",
      email: "mallory@example.com",
    });
    expect(res.error).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "CUSTOMER_MISMATCH" },
    });
    expect(calls.some((c) => c.method === "POST" || c.method === "PUT")).toBe(false);
  });

  it("matches a guest order by contact_email", async () => {
    const guest = makeOrder({ customer: null, contact_email: "guest@example.com" });
    mockFetch(storeRoutes(guest));
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      order_id: String(guest.id),
      email: "guest@example.com",
    });
    expect(res.isError).toBe(false);
  });

  it("marks the order before creating the coupon, so a failure cannot be re-issued", async () => {
    const order = makeOrder();
    const { calls } = mockFetch(
      orderRoutes(order, {
        extra: [
          { method: "POST", path: `${BASE}/coupons`, reply: () => ({ status: 422, body: {} }) },
          {
            method: "PUT",
            path: `${BASE}/orders/${order.id}`,
            reply: ({ body }) => ({ ...order, ...body }),
          },
        ],
      }),
    );
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      ...ORDER_ARGS,
    });
    expect(res.isError).toBe(true);
    expect(res.error).toMatchObject({
      retryable: false,
      details: { reason: "COUPON_CREATE_FAILED" },
    });
    expect(res.text).toMatch(/do not retry/);
    const writes = calls.filter((c) => c.method === "PUT" || c.method === "POST").map((c) => c.method);
    expect(writes).toEqual(["PUT", "POST"]);
    expect(calls.find((c) => c.method === "PUT").body.owner_note).toMatch(/HAY COUPON HAY/);
  });

  it("issues nothing when the order note cannot be written", async () => {
    const order = makeOrder();
    const { calls } = mockFetch(
      orderRoutes(order, {
        extra: [
          couponRoute(),
          {
            method: "PUT",
            path: `${BASE}/orders/${order.id}`,
            reply: () => ({ status: 422, body: {} }),
          },
        ],
      }),
    );
    const res = await server.call("nuvemshop_create_coupon", {
      type: "percentage",
      value: 5,
      reason: "late",
      ...ORDER_ARGS,
    });
    expect(res.isError).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});
