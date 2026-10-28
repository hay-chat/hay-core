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
  lineItems: [
    { id: "li-1", quantity: 2 },
    { id: "li-2", quantity: 1 },
  ],
};

/** Documented Get Order Refundability shape: everything refundable. */
function allRefundable(payments) {
  return { payments: payments.map((p) => ({ payment: { paymentId: p.id }, refundable: true })) };
}

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
      reply: () => refundability ?? allRefundable(payments),
    },
    {
      method: "POST",
      path: "/ecom/v1/order-billing/refund-payments",
      reply: (ctx) =>
        onRefund
          ? onRefund(ctx)
          : {
              refund: {
                id: "r-1",
                transactions: ctx.body.paymentRefunds.map((p) => ({
                  paymentId: p.paymentId,
                  amount: p.amount,
                  refundStatus: "SUCCEEDED",
                })),
              },
            },
    },
  ];
}

const CARD = {
  id: "pay-1",
  amount: { amount: "50.00" },
  regularPaymentDetails: { status: "APPROVED", paymentMethod: "CreditCard" },
};

describe("parseRefundabilities", () => {
  it("reads the documented one-of shape per payment", () => {
    expect(
      parseRefundabilities({
        payments: [
          { payment: { paymentId: "a" }, refundable: true },
          {
            payment: { paymentId: "b" },
            manuallyRefundable: { reason: "NOT_SUPPORTED" },
            providerLink: "https://provider/refunds",
          },
          { payment: { paymentId: "c" }, nonRefundable: { reason: "ALREADY_REFUNDED" } },
          { payment: {} },
        ],
      }),
    ).toEqual({
      a: { state: "REFUNDABLE", reason: null, providerLink: null },
      b: {
        state: "MANUALLY_REFUNDABLE",
        reason: "NOT_SUPPORTED",
        providerLink: "https://provider/refunds",
      },
      c: { state: "NON_REFUNDABLE", reason: "ALREADY_REFUNDED", providerLink: null },
    });
    expect(parseRefundabilities({})).toBeNull();
    expect(parseRefundabilities({ payments: [] })).toBeNull();
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

  it("refuses a currency that is not the order's, before refunding", async () => {
    const { calls } = mockFetch(routes({ payments: [CARD] }));
    const res = await server.call("wix_create_refund", { currency: "USD", order_id: "ord-1" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/is in EUR, not USD/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("issues a full refund against the right payment with the documented side effects", async () => {
    const { calls } = mockFetch(routes({ payments: [CARD] }));
    const res = await server.call("wix_create_refund", {
      currency: "EUR",
      order_id: "ord-1",
      restock: true,
      notify_customer: true,
      reason: "damaged",
    });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      refunded: true,
      external: false,
      id: "ord-1",
      refundId: "r-1",
      refundStatus: [{ paymentId: "pay-1", status: "SUCCEEDED" }],
      amount: { amount: "50.00", currency: "EUR" },
      remainingRefundable: { amount: "0.00" },
      restocked: true,
    });
    const refund = calls.find((c) => c.path.endsWith("/refund-payments"));
    expect(refund.body).toEqual({
      orderId: "ord-1",
      paymentRefunds: [{ paymentId: "pay-1", amount: { amount: "50.00" } }],
      customerReason: "damaged",
      sideEffects: {
        restock: {
          lineItems: [
            { lineItemId: "li-1", quantity: 2 },
            { lineItemId: "li-2", quantity: 1 },
          ],
        },
        notifications: { sendCustomerEmail: true },
      },
    });
  });

  it("caps a partial refund at the remaining balance and never restocks on a partial", async () => {
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
    const tooMuch = await server.call("wix_create_refund", {
      currency: "EUR",
      order_id: "ord-1",
      amount: "25.00",
    });
    expect(tooMuch.isError).toBe(true);
    expect(tooMuch.text).toMatch(/exceeds the remaining refundable balance of 20.00/);
    expect(calls.some((c) => c.path.endsWith("/refund-payments"))).toBe(false);

    const okRes = await server.call("wix_create_refund", {
      currency: "EUR",
      order_id: "ord-1",
      amount: "20.00",
      restock: true,
    });
    expect(okRes.data.refunded).toBe(true);
    expect(okRes.data.restocked).toBe(false);
    expect(okRes.data.payments).toEqual([{ paymentId: "pay-1", amount: 20 }]);
    const refund = calls.find((c) => c.path.endsWith("/refund-payments"));
    expect(refund.body.sideEffects).toBeUndefined();
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
    expect(
      (await server.call("wix_create_refund", { currency: "EUR", order_id: "ord-1" })).text,
    ).toMatch(/nothing left to refund/);
    mockFetch(routes({ payments: [CARD] }));
    expect(
      (await server.call("wix_create_refund", { currency: "EUR", order_id: "ord-1", amount: "-1" }))
        .text,
    ).toMatch(/Invalid refund amount/);
  });

  it("does not call the provider when Wix says the payment is only manually refundable", async () => {
    const { calls } = mockFetch(
      routes({
        payments: [CARD],
        refundability: {
          payments: [
            {
              payment: { paymentId: "pay-1" },
              manuallyRefundable: { reason: "NOT_SUPPORTED" },
              providerLink: "https://provider/refunds",
            },
          ],
        },
      }),
    );
    const res = await server.call("wix_create_refund", { currency: "EUR", order_id: "ord-1" });
    expect(res.isError).toBe(false);
    expect(res.data.refunded).toBe(false);
    expect(res.data.reason).toBe("provider_not_api_refundable");
    expect(res.data.message).toMatch(/NOT_SUPPORTED/);
    expect(res.data.message).toMatch(/https:\/\/provider\/refunds/);
    expect(res.data.message).toMatch(/external_refund=true/);
    expect(calls.some((c) => c.path.endsWith("/refund-payments"))).toBe(false);
  });

  it("spans two payments and refuses when one of them is non-refundable", async () => {
    const second = { ...CARD, id: "pay-2", amount: { amount: "20.00" } };
    const { calls } = mockFetch(routes({ payments: [CARD, second] }));
    const res = await server.call("wix_create_refund", {
      currency: "EUR",
      order_id: "ord-1",
      amount: "60.00",
    });
    expect(res.data.payments).toEqual([
      { paymentId: "pay-1", amount: 50 },
      { paymentId: "pay-2", amount: 10 },
    ]);
    expect(calls.find((c) => c.path.endsWith("/refund-payments")).body.paymentRefunds).toEqual([
      { paymentId: "pay-1", amount: { amount: "50.00" } },
      { paymentId: "pay-2", amount: { amount: "10.00" } },
    ]);

    const { calls: calls2 } = mockFetch(
      routes({
        payments: [CARD, second],
        refundability: {
          payments: [
            { payment: { paymentId: "pay-1" }, refundable: true },
            { payment: { paymentId: "pay-2" }, nonRefundable: { reason: "PENDING_REFUND" } },
          ],
        },
      }),
    );
    const blocked = await server.call("wix_create_refund", {
      currency: "EUR",
      order_id: "ord-1",
      amount: "60.00",
    });
    expect(blocked.data.refunded).toBe(false);
    expect(blocked.data.message).toMatch(/pay-2 \(PENDING_REFUND\) cannot be refunded/);
    expect(calls2.some((c) => c.path.endsWith("/refund-payments"))).toBe(false);
  });

  it("records an external refund without the refundability check", async () => {
    const { calls } = mockFetch(routes({ payments: [CARD] }));
    const res = await server.call("wix_create_refund", {
      currency: "EUR",
      order_id: "ord-1",
      amount: "10.00",
      external_refund: true,
    });
    expect(res.data).toMatchObject({ refunded: true, external: true });
    expect(calls.some((c) => c.path.endsWith("/get-order-refundability"))).toBe(false);
    const refund = calls.find((c) => c.path.endsWith("/refund-payments"));
    expect(refund.body.paymentRefunds[0]).toEqual({
      paymentId: "pay-1",
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
    const res = await server.call("wix_create_refund", { currency: "EUR", order_id: "ord-1" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Provider declined \(DECLINED\)/);
  });
});
