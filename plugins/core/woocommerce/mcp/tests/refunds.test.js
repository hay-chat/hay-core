import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerRefundTools, buildLineItemRefund } = require("../tools/refunds");

process.env.WORDPRESS_SITE_URL = "https://store.test";
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs";

const WC = "/wp-json/wc/v3";
const ORDER = {
  id: 12,
  number: "12",
  status: "completed",
  currency: "EUR",
  date_paid: "2026-10-01T10:01:00",
  total: "60.00",
  payment_method: "stripe",
  payment_method_title: "Card (Stripe)",
  line_items: [
    {
      id: 101,
      name: "Hat",
      quantity: 2,
      total: "40.00",
      total_tax: "8.00",
      taxes: [{ id: 1, total: "8.00" }],
    },
    {
      id: 102,
      name: "Scarf",
      quantity: 1,
      total: "10.00",
      total_tax: "2.00",
      taxes: [{ id: 1, total: "2.00" }],
    },
  ],
  refunds: [],
};

function routes(order, onRefund) {
  return [
    { method: "GET", path: `${WC}/orders/${order.id}`, reply: () => order },
    {
      method: "POST",
      path: `${WC}/orders/${order.id}/refunds`,
      reply: (ctx) => (onRefund ? onRefund(ctx) : { id: 500, ...ctx.body }),
    },
  ];
}

describe("buildLineItemRefund", () => {
  it("computes amounts from the order's own totals and taxes, pro rata", () => {
    const { lines, amount } = buildLineItemRefund(ORDER, [{ line_item_id: "101", quantity: 1 }]);
    expect(lines).toEqual([
      { id: 101, quantity: 1, refund_total: 20, refund_tax: [{ id: 1, refund_total: 4 }] },
    ]);
    expect(amount).toBe(24);
  });
  it("rejects unknown items and bad quantities", () => {
    expect(() => buildLineItemRefund(ORDER, [{ line_item_id: "9", quantity: 1 }])).toThrow(
      /Valid line item ids: 101 \(Hat\), 102 \(Scarf\)/,
    );
    expect(() => buildLineItemRefund(ORDER, [{ line_item_id: "101", quantity: 3 }])).toThrow(
      /between 1 and 2/,
    );
  });
});

describe("woocommerce_create_refund", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerRefundTools(server);
  });

  it("refuses a currency that is not the order's, before refunding", async () => {
    const { calls } = mockFetch(routes(ORDER));
    const res = await server.call("woocommerce_create_refund", { currency: "usd", order_id: "12" });
    expect(res.isError).toBe(true);
    expect(res.error).toMatchObject({
      code: "BAD_INPUT",
      details: { reason: "CURRENCY_MISMATCH" },
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("refunds the full remaining balance through the gateway by default", async () => {
    const { calls } = mockFetch(routes(ORDER));
    const res = await server.call("woocommerce_create_refund", {
      currency: "EUR",
      order_id: "12",
      reason: "damaged",
    });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      refunded: true,
      gatewayRefunded: true,
      refundId: 500,
      amount: { amount: "60.00", currency: "EUR" },
      remainingRefundable: { amount: "0.00" },
    });
    expect(calls.find((c) => c.method === "POST").body).toEqual({
      amount: "60.00",
      reason: "damaged",
      api_refund: true,
      api_restock: false,
    });
  });

  it("refunds specific items with the computed amount and restock flag", async () => {
    const { calls } = mockFetch(routes(ORDER));
    const res = await server.call("woocommerce_create_refund", {
      currency: "EUR",
      order_number: "12",
      line_items: [{ line_item_id: "101", quantity: 2 }],
      restock: true,
    });
    expect(res.data.amount.amount).toBe("48.00");
    expect(res.data.lineItems).toEqual([{ id: 101, quantity: 2, refundTotal: 40 }]);
    const body = calls.find((c) => c.method === "POST").body;
    expect(body.api_restock).toBe(true);
    expect(body.line_items[0]).toEqual({
      id: 101,
      quantity: 2,
      refund_total: 40,
      refund_tax: [{ id: 1, refund_total: 8 }],
    });
  });

  it("caps at total minus earlier refunds and refuses fully refunded orders", async () => {
    const partly = { ...ORDER, refunds: [{ id: 1, reason: "", total: "-50.00" }] };
    const { calls } = mockFetch(routes(partly));
    const tooMuch = await server.call("woocommerce_create_refund", {
      currency: "EUR",
      order_id: "12",
      amount: "15.00",
    });
    expect(tooMuch.isError).toBe(true);
    expect(tooMuch.error).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "EXCEEDS_REFUNDABLE" },
    });
    expect(tooMuch.text).toMatch(/exceeds the remaining refundable balance of 10.00 EUR/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    const fine = await server.call("woocommerce_create_refund", {
      currency: "EUR",
      order_id: "12",
      amount: "10.00",
    });
    expect(fine.data.refunded).toBe(true);

    mockFetch(routes({ ...ORDER, refunds: [{ id: 1, reason: "", total: "-60.00" }] }));
    expect(
      (await server.call("woocommerce_create_refund", { currency: "EUR", order_id: "12" })).text,
    ).toMatch(/already fully refunded/);
  });

  it("refuses orders with no recorded payment", async () => {
    const { calls } = mockFetch(routes({ ...ORDER, status: "on-hold", date_paid: null }));
    const res = await server.call("woocommerce_create_refund", { currency: "EUR", order_id: "12" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/no recorded payment/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("after an unconfirmed refund (5xx without a WooCommerce error) does not suggest re-running it", async () => {
    const { calls } = mockFetch(routes(ORDER, () => ({ status: 502, body: null })));
    const res = await server.call("woocommerce_create_refund", { currency: "EUR", order_id: "12" });
    expect(res.error).toMatchObject({ code: "OUTCOME_UNKNOWN", retryable: false });
    expect(res.text).not.toMatch(/refund_payment=false/);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("on a gateway refusal tells the agent to hand off, never to re-run record-only", async () => {
    mockFetch(
      routes(ORDER, () => ({
        status: 500,
        body: {
          code: "woocommerce_rest_cannot_create_order_refund",
          message: "The payment gateway does not support refunds.",
        },
      })),
    );
    const failed = await server.call("woocommerce_create_refund", {
      currency: "EUR",
      order_id: "12",
    });
    expect(failed.isError).toBe(true);
    expect(failed.error.code).toBe("PROVIDER_REFUSED");
    expect(failed.text).toMatch(/does not support refunds/);
    expect(failed.text).toMatch(/Do NOT re-run/);
    expect(failed.text).toMatch(/hand off/);
    expect(failed.text).not.toMatch(/refund_payment=false/);
  });

  it("refuses record-only on an online gateway", async () => {
    const { calls } = mockFetch(routes(ORDER));
    const res = await server.call("woocommerce_create_refund", {
      currency: "EUR",
      order_id: "12",
      refund_payment: false,
    });
    expect(res.error).toMatchObject({
      code: "PRECONDITION",
      details: { reason: "RECORD_ONLY_NOT_ALLOWED" },
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("records an offline (bacs) refund and says no money moved", async () => {
    const bacs = { ...ORDER, payment_method: "bacs", payment_method_title: "Bank transfer" };
    const { calls } = mockFetch(routes(bacs));
    const res = await server.call("woocommerce_create_refund", {
      currency: "EUR",
      order_id: "12",
      amount: "5.00",
      refund_payment: false,
    });
    expect(res.data).toMatchObject({
      refunded: true,
      gatewayRefunded: false,
      moneyMoved: false,
      recordedOnly: true,
    });
    expect(res.data.note).toMatch(/no money was sent/);
    expect(calls.find((c) => c.method === "POST").body.api_refund).toBe(false);
  });

  it("rejects invalid amounts", async () => {
    mockFetch(routes(ORDER));
    expect(
      (
        await server.call("woocommerce_create_refund", {
          currency: "EUR",
          order_id: "12",
          amount: "abc",
        })
      ).text,
    ).toMatch(/Invalid refund amount/);
  });
});
