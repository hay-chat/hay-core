import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerRefundTools, parseRefundabilities, allocateRefund } = require("../tools/refunds");

process.env.WIX_API_KEY = "test-key";
process.env.WIX_SITE_ID = "site-1";

const ORDER = {
  id: "ord-1",
  number: "10042",
  status: "APPROVED",
  currency: "EUR",
  fulfillmentStatus: "FULFILLED",
};

function routes({ payments, refunds = [], refundability, onRefund }) {
  return [
    { method: "GET", path: "/ecom/v1/orders/ord-1", reply: () => ({ order: ORDER }) },
    {
      method: "GET",
      path: "/ecom/v1/orders/ord-1/transactions",
      reply: () => ({ orderTransactions: { payments, refunds } }),
    },
    {
      method: "POST",
      path: "/ecom/v1/order-billing/get-order-refundability",
      reply: () =>
        refundability ?? {
          refundabilities: payments.map((p) => ({
            transactionId: p.id,
            refundability: "REFUNDABLE",
          })),
        },
    },
    {
      method: "POST",
      path: "/ecom/v1/order-billing/refund-payments",
      reply: (ctx) => (onRefund ? onRefund(ctx) : { refunds: [{ id: "r-1" }] }),
    },
  ];
}

const CARD = {
  id: "pay-1",
  amount: { amount: "50.00" },
  regularPaymentDetails: { status: "APPROVED", paymentMethod: "CreditCard" },
};

describe("parseRefundabilities", () => {
  it("normalises the states Wix has shipped under different keys", () => {
    expect(
      parseRefundabilities({
        refundabilities: [
          { transactionId: "a", refundability: "REFUNDABLE" },
          { transactionId: "b", refundabilityStatus: "MANUALLY_REFUNDABLE" },
          { paymentId: "c", refundable: false, nonRefundableReason: "ALREADY_REFUNDED" },
        ],
      }),
    ).toEqual({
      a: { state: "REFUNDABLE", reason: null },
      b: { state: "MANUALLY_REFUNDABLE", reason: null },
      c: { state: "NON_REFUNDABLE", reason: "ALREADY_REFUNDED" },
    });
    expect(parseRefundabilities({})).toBeNull();
  });
});

describe("allocateRefund", () => {
  const payments = [
    { paymentId: "small", remaining: 10, refundDisabled: false },
    { paymentId: "big", remaining: 40, refundDisabled: false },
    { paymentId: "gift", remaining: 5, refundDisabled: true },
  ];
  it("refunds everything that is left when no amount is given", () => {
    expect(allocateRefund(payments, null)).toEqual([
      { paymentId: "big", amount: 40 },
      { paymentId: "small", amount: 10 },
    ]);
  });
  it("spreads a partial amount largest-first and skips disabled payments", () => {
    expect(allocateRefund(payments, 45.5)).toEqual([
      { paymentId: "big", amount: 40 },
      { paymentId: "small", amount: 5.5 },
    ]);
  });
});

describe("wix_create_refund", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerRefundTools(server);
  });

  it("issues a full refund against the right payment with the side effects asked for", async () => {
    const { calls } = mockFetch(routes({ payments: [CARD] }));
    const res = await server.call("wix_create_refund", {
      order_id: "ord-1",
      restock: true,
      reason: "damaged",
    });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      refunded: true,
      external: false,
      amount: { amount: "50.00", currency: "EUR" },
      remainingRefundable: { amount: "0.00" },
    });
    const refund = calls.find((c) => c.path.endsWith("/refund-payments"));
    expect(refund.body).toEqual({
      orderId: "ord-1",
      paymentRefunds: [{ transactionId: "pay-1", amount: { amount: "50.00" } }],
      sideEffects: { restockAllItems: true, sendOrderRefundedEmail: false },
      reason: "damaged",
    });
  });

  it("caps a partial refund at the remaining balance after earlier refunds", async () => {
    const { calls } = mockFetch(
      routes({
        payments: [CARD],
        refunds: [
          {
            transactions: [
              { paymentId: "pay-1", amount: { amount: "30.00" }, refundStatus: "SUCCEEDED" },
            ],
          },
        ],
      }),
    );
    const tooMuch = await server.call("wix_create_refund", { order_id: "ord-1", amount: "25.00" });
    expect(tooMuch.isError).toBe(true);
    expect(tooMuch.text).toMatch(/exceeds the remaining refundable balance of 20.00/);
    expect(calls.some((c) => c.path.endsWith("/refund-payments"))).toBe(false);

    const okRes = await server.call("wix_create_refund", { order_id: "ord-1", amount: "20.00" });
    expect(okRes.data.refunded).toBe(true);
    expect(okRes.data.payments).toEqual([{ paymentId: "pay-1", amount: 20 }]);
  });

  it("refuses a fully refunded order and invalid amounts", async () => {
    mockFetch(
      routes({
        payments: [CARD],
        refunds: [
          {
            transactions: [
              { paymentId: "pay-1", amount: { amount: "50.00" }, refundStatus: "SUCCEEDED" },
            ],
          },
        ],
      }),
    );
    expect((await server.call("wix_create_refund", { order_id: "ord-1" })).text).toMatch(
      /nothing left to refund/,
    );
    mockFetch(routes({ payments: [CARD] }));
    expect(
      (await server.call("wix_create_refund", { order_id: "ord-1", amount: "-1" })).text,
    ).toMatch(/Invalid refund amount/);
  });

  it("does not call the provider when Wix says the payment is only manually refundable", async () => {
    const { calls } = mockFetch(
      routes({
        payments: [CARD],
        refundability: {
          refundabilities: [{ transactionId: "pay-1", refundability: "MANUALLY_REFUNDABLE" }],
        },
      }),
    );
    const res = await server.call("wix_create_refund", { order_id: "ord-1" });
    expect(res.isError).toBe(false);
    expect(res.data.refunded).toBe(false);
    expect(res.data.reason).toBe("provider_not_api_refundable");
    expect(res.data.message).toMatch(/external_refund=true/);
    expect(calls.some((c) => c.path.endsWith("/refund-payments"))).toBe(false);
  });

  it("records an external refund without the refundability check", async () => {
    const { calls } = mockFetch(routes({ payments: [CARD] }));
    const res = await server.call("wix_create_refund", {
      order_id: "ord-1",
      amount: "10.00",
      external_refund: true,
    });
    expect(res.data).toMatchObject({ refunded: true, external: true });
    expect(calls.some((c) => c.path.endsWith("/get-order-refundability"))).toBe(false);
    const refund = calls.find((c) => c.path.endsWith("/refund-payments"));
    expect(refund.body.paymentRefunds[0]).toEqual({
      transactionId: "pay-1",
      amount: { amount: "10.00" },
      externalRefund: true,
    });
  });

  it("surfaces Wix's error body when the refund call fails", async () => {
    mockFetch(
      routes({
        payments: [CARD],
        onRefund: () => ({
          status: 400,
          body: {
            message: "bad",
            details: { applicationError: { description: "Provider declined", code: "DECLINED" } },
          },
        }),
      }),
    );
    const res = await server.call("wix_create_refund", { order_id: "ord-1" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Provider declined \(DECLINED\)/);
  });
});
