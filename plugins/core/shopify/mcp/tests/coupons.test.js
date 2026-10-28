import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockShopify } = require("./harness");
const { registerCouponTools, couponPolicy, goodwillTitle } = require("../tools/coupons");

const ENV = [
  "SHOPIFY_COUPONS_ENABLED",
  "SHOPIFY_COUPON_MAX_PERCENT",
  "SHOPIFY_COUPON_MAX_AMOUNT",
  "SHOPIFY_COUPON_MAX_DAYS",
];
const CUSTOMER = "gid://shopify/Customer/7";
const BASE_ARGS = {
  email: "ana@example.com",
  type: "percentage",
  value: 10,
  reason: "late parcel",
};

const discount = (overrides = {}) => ({
  id: "gid://shopify/DiscountCodeNode/1",
  codeDiscount: {
    title: goodwillTitle(CUSTOMER),
    status: "ACTIVE",
    endsAt: "2099-01-01T00:00:00Z",
    usageLimit: 1,
    asyncUsageCount: 0,
    codes: { nodes: [{ code: "HAYABCDEFGH" }] },
    ...overrides,
  },
});

function handlers({ existing = [], customers, order } = {}) {
  return {
    FindCouponCustomer: () => ({
      customers: {
        nodes: customers ?? [
          { id: CUSTOMER, defaultEmailAddress: { emailAddress: "Ana@Example.com" } },
        ],
      },
    }),
    FindGoodwillDiscounts: () => ({ codeDiscountNodes: { nodes: existing } }),
    GetCouponOrder: () => ({
      order: order ?? {
        id: "gid://shopify/Order/12",
        name: "#1012",
        note: "VIP",
        currencyCode: "EUR",
        customer: { id: CUSTOMER },
      },
    }),
    CreateGoodwillDiscount: () => ({
      discountCodeBasicCreate: {
        codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/9" },
        userErrors: [],
      },
    }),
    AddCouponOrderNote: () => ({
      orderUpdate: { order: { id: "gid://shopify/Order/12" }, userErrors: [] },
    }),
  };
}

const created = (calls) => calls.filter((c) => c.op === "CreateGoodwillDiscount");
const errorOf = (res) => JSON.parse(res.text);

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

describe("shopify_create_coupon", () => {
  it("creates a single-use code only this customer can use", async () => {
    const { calls } = mockShopify(handlers());
    const res = await server.call("shopify_create_coupon", BASE_ARGS);
    expect(res.isError).toBe(false);
    const input = created(calls)[0].variables.basicCodeDiscount;
    expect(input).toMatchObject({
      title: "Hay.chat goodwill coupon · customer 7",
      usageLimit: 1,
      appliesOncePerCustomer: true,
      context: { customers: { add: [CUSTOMER] } },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
      customerGets: { value: { percentage: 0.1 }, items: { all: true } },
    });
    expect(input.code).toMatch(/^HAY[A-Z2-9]{8}$/);
    const days = (Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 86400000;
    expect(days).toBe(30);
    expect(res.data).toMatchObject({ created: true, code: input.code, usageLimit: 1 });
    expect(calls.find((c) => c.op === "FindCouponCustomer").variables.query).toBe(
      'email:"ana@example.com"',
    );
  });

  it("refuses above the cap with NEEDS_APPROVAL and calls nothing", async () => {
    const { calls } = mockShopify(handlers());
    const res = await server.call("shopify_create_coupon", { ...BASE_ARGS, value: 20 });
    expect(res.isError).toBe(true);
    expect(errorOf(res)).toMatchObject({
      code: "NEEDS_APPROVAL",
      details: { type: "percentage", requested: 20, cap: 10 },
    });
    expect(res.text).not.toMatch(/held|pending/i);
    expect(calls).toHaveLength(0);
  });

  it("creates an over-cap code on the approved retry", async () => {
    const { calls } = mockShopify(handlers());
    const res = await server.call("shopify_create_coupon", {
      ...BASE_ARGS,
      value: 20,
      hay_approval_id: "pa-1",
    });
    expect(res.isError).toBe(false);
    expect(created(calls)[0].variables.basicCodeDiscount.customerGets.value).toEqual({
      percentage: 0.2,
    });
  });

  it("fixed amounts are off by default and capped once the merchant sets a ceiling", async () => {
    mockShopify(handlers());
    let res = await server.call("shopify_create_coupon", { ...BASE_ARGS, type: "absolute" });
    expect(errorOf(res)).toMatchObject({ code: "PRECONDITION" });

    process.env.SHOPIFY_COUPON_MAX_AMOUNT = "15";
    res = await server.call("shopify_create_coupon", { ...BASE_ARGS, type: "absolute", value: 16 });
    expect(errorOf(res)).toMatchObject({
      code: "NEEDS_APPROVAL",
      details: { amount: 16, cap: 15 },
    });

    const { calls } = mockShopify(handlers());
    await server.call("shopify_create_coupon", { ...BASE_ARGS, type: "absolute", value: 15 });
    expect(created(calls)[0].variables.basicCodeDiscount.customerGets.value).toEqual({
      discountAmount: { amount: "15.00", appliesOnEachItem: false },
    });
  });

  it("refuses when coupons are turned off, even when approved", async () => {
    process.env.SHOPIFY_COUPONS_ENABLED = "false";
    const { calls } = mockShopify(handlers());
    const res = await server.call("shopify_create_coupon", {
      ...BASE_ARGS,
      hay_approval_id: "pa-1",
    });
    expect(errorOf(res)).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "COUPONS_DISABLED" },
    });
    expect(calls).toHaveLength(0);
  });

  it("caps valid_days at the merchant's maximum", async () => {
    process.env.SHOPIFY_COUPON_MAX_DAYS = "5";
    const { calls } = mockShopify(handlers());
    await server.call("shopify_create_coupon", { ...BASE_ARGS, valid_days: 60 });
    const input = created(calls)[0].variables.basicCodeDiscount;
    expect((Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 86400000).toBe(5);
  });

  it("needs an existing customer with that exact email", async () => {
    const { calls } = mockShopify(
      handlers({
        customers: [
          {
            id: "gid://shopify/Customer/8",
            defaultEmailAddress: { emailAddress: "ana@example.co" },
          },
        ],
      }),
    );
    const res = await server.call("shopify_create_coupon", BASE_ARGS);
    expect(errorOf(res)).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "NO_CUSTOMER" },
    });
    expect(created(calls)).toHaveLength(0);
  });

  it("allows one active goodwill coupon per customer, approved or not", async () => {
    const { calls } = mockShopify(handlers({ existing: [discount()] }));
    const res = await server.call("shopify_create_coupon", {
      ...BASE_ARGS,
      hay_approval_id: "pa-1",
    });
    expect(errorOf(res)).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "ALREADY_HAS_COUPON", code: "HAYABCDEFGH" },
    });
    expect(created(calls)).toHaveLength(0);
  });

  it("ignores used, expired and other customers' discounts", async () => {
    const { calls } = mockShopify(
      handlers({
        existing: [
          discount({ asyncUsageCount: 1 }),
          discount({ endsAt: "2020-01-01T00:00:00Z" }),
          discount({ status: "EXPIRED" }),
          discount({ title: goodwillTitle("gid://shopify/Customer/70") }),
        ],
      }),
    );
    const res = await server.call("shopify_create_coupon", BASE_ARGS);
    expect(res.isError).toBe(false);
    expect(created(calls)).toHaveLength(1);
  });

  it("searches for this customer's exact title and pages through every hit", async () => {
    const other = discount({ title: goodwillTitle("gid://shopify/Customer/70") });
    const { calls } = mockShopify({
      ...handlers(),
      FindGoodwillDiscounts: (vars) =>
        vars.after
          ? { codeDiscountNodes: { nodes: [discount()], pageInfo: { hasNextPage: false } } }
          : {
              codeDiscountNodes: {
                nodes: Array.from({ length: 50 }, () => other),
                pageInfo: { hasNextPage: true, endCursor: "c1" },
              },
            },
    });
    const res = await server.call("shopify_create_coupon", BASE_ARGS);
    expect(errorOf(res)).toMatchObject({ details: { reason: "ALREADY_HAS_COUPON" } });
    const searches = calls.filter((c) => c.op === "FindGoodwillDiscounts");
    expect(searches).toHaveLength(2);
    expect(searches[0].variables.query).toBe('title:"Hay.chat goodwill coupon · customer 7"');
    expect(searches[1].variables.after).toBe("c1");
    expect(created(calls)).toHaveLength(0);
  });

  it("fails closed when the goodwill search never ends", async () => {
    const { calls } = mockShopify({
      ...handlers(),
      FindGoodwillDiscounts: () => ({
        codeDiscountNodes: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "c" } },
      }),
    });
    const res = await server.call("shopify_create_coupon", BASE_ARGS);
    expect(errorOf(res)).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "GOODWILL_CHECK_INCOMPLETE" },
    });
    expect(created(calls)).toHaveLength(0);
  });

  it("ties the code to the customer's order and appends it to the order note", async () => {
    const { calls } = mockShopify(handlers());
    const res = await server.call("shopify_create_coupon", { ...BASE_ARGS, order_id: "12" });
    expect(res.data.orderName).toBe("#1012");
    const note = calls.find((c) => c.op === "AddCouponOrderNote").variables.note;
    expect(note).toMatch(/^VIP\n\n\[Hay\.chat\] Goodwill coupon HAY[A-Z2-9]{8}: 10\.00% off/);
  });

  it("refuses an order that belongs to another customer", async () => {
    const { calls } = mockShopify(
      handlers({
        order: {
          id: "gid://shopify/Order/12",
          name: "#1012",
          customer: { id: "gid://shopify/Customer/99" },
        },
      }),
    );
    const res = await server.call("shopify_create_coupon", { ...BASE_ARGS, order_id: "12" });
    expect(errorOf(res)).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "CUSTOMER_MISMATCH" },
    });
    expect(created(calls)).toHaveLength(0);
  });

  it("surfaces Shopify userErrors as PROVIDER_REFUSED", async () => {
    mockShopify({
      ...handlers(),
      CreateGoodwillDiscount: () => ({
        discountCodeBasicCreate: {
          codeDiscountNode: null,
          userErrors: [{ field: ["basicCodeDiscount"], code: "INVALID", message: "Access denied" }],
        },
      }),
    });
    const res = await server.call("shopify_create_coupon", BASE_ARGS);
    expect(errorOf(res)).toMatchObject({ code: "PROVIDER_REFUSED" });
  });
});
