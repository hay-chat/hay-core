/**
 * Mercado Pago contract tools against a mocked API (no real account).
 */
import { createRequire } from "node:module";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerPaymentTools } = require("../tools/payments");
const { candidateReferences, normalizePayment } = require("../lib/payments");
const { assertPaymentShape } = require("@hay/plugin-sdk/payment-provider");

const HOUR = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

function pixPending(overrides = {}) {
  return {
    id: 1111111111,
    status: "pending",
    status_detail: "pending_waiting_transfer",
    payment_method_id: "pix",
    payment_type_id: "bank_transfer",
    transaction_amount: 199.9,
    transaction_amount_refunded: 0,
    currency_id: "BRL",
    date_created: iso(Date.now() - HOUR),
    date_of_expiration: iso(Date.now() + HOUR),
    external_reference: "WC-1042",
    payer: { email: "Ana@Example.com", phone: { area_code: "11", number: "987654321" } },
    point_of_interaction: {
      transaction_data: {
        qr_code:
          "00020126580014br.gov.bcb.pix0136a1b2c3d4-e5f6-7890-abcd-ef1234567890520400005303986",
        qr_code_base64: "iVBORw0KGgo=",
        ticket_url: "https://www.mercadopago.com.br/payments/1111111111/ticket?caller_id=1",
      },
    },
    refunds: [],
    ...overrides,
  };
}

function cardApproved(overrides = {}) {
  return {
    id: 2222222222,
    status: "approved",
    status_detail: "accredited",
    payment_method_id: "visa",
    payment_type_id: "credit_card",
    transaction_amount: 100,
    transaction_amount_refunded: 0,
    currency_id: "BRL",
    date_created: "2026-10-20T10:00:00.000-03:00",
    date_approved: "2026-10-20T10:00:05.000-03:00",
    external_reference: "WC-1043",
    payer: { email: "bia@example.com" },
    refunds: [],
    ...overrides,
  };
}

let server;
let env;

beforeEach(() => {
  env = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-test-token";
  server = createFakeServer();
  registerPaymentTools(server);
});

afterEach(() => {
  if (env === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
  else process.env.MERCADOPAGO_ACCESS_TOKEN = env;
});

describe("mercadopago_get_payment", () => {
  it("returns the contract shape, never the Pix code, and sends the bearer token", async () => {
    const { calls } = mockFetch([{ path: "/v1/payments/1111111111", reply: () => pixPending() }]);
    const res = await server.call("mercadopago_get_payment", { payment_id: "1111111111" });
    expect(assertPaymentShape(res.data)).toEqual([]);
    expect(res.data).toMatchObject({
      status: "pending",
      method: "pix",
      amount: 199.9,
      currency: "BRL",
    });
    expect(res.text).not.toContain("000201");
    expect(calls[0].init.headers.Authorization).toBe("Bearer APP_USR-test-token");
  });

  it("maps a 401 to AUTH_FAILED", async () => {
    mockFetch([
      { path: /payments/, reply: () => ({ status: 401, body: { message: "invalid token" } }) },
    ]);
    const res = await server.call("mercadopago_get_payment", { payment_id: "1" });
    expect(res.error.code).toBe("AUTH_FAILED");
  });
});

describe("mercadopago_find_payments (order mapping)", () => {
  it("builds lookups from Woo meta ids, Shopify transaction ids and the order id", () => {
    expect(
      candidateReferences({
        paymentIds: ["123456789, 987654321"],
        orderId: "1042",
        source: "woocommerce",
      }),
    ).toEqual({
      ids: ["123456789", "987654321"],
      externalReferences: ["1042", "WC-1042"],
    });
    expect(
      candidateReferences({
        paymentIds: ["r4nd0m-session-id"],
        orderId: "#1001",
        source: "shopify",
      }),
    ).toEqual({
      ids: [],
      externalReferences: ["r4nd0m-session-id", "1001"],
    });
  });

  it("fetches ids, skips ids that are not Mercado Pago payments, and searches order references", async () => {
    const { calls } = mockFetch([
      { path: "/v1/payments/2222222222", reply: () => cardApproved() },
      {
        path: "/v1/payments/5555555555",
        reply: () => ({ status: 404, body: { message: "not found" } }),
      },
      {
        path: "/v1/payments/search",
        reply: ({ query }) => ({
          results: query.get("external_reference") === "WC-1043" ? [cardApproved()] : [],
        }),
      },
    ]);
    const res = await server.call("mercadopago_find_payments", {
      payment_ids: ["2222222222", "5555555555"],
      order_id: "1043",
      source: "woocommerce",
    });
    expect(res.isError).toBe(false);
    expect(res.data.found).toBe(true);
    expect(res.data.payments).toHaveLength(1);
    const searched = calls
      .filter((c) => c.path === "/v1/payments/search")
      .map((c) => c.query.get("external_reference"));
    expect(searched).toEqual(["1043", "WC-1043"]);
  });

  it("needs something to look up", async () => {
    mockFetch([]);
    const res = await server.call("mercadopago_find_payments", {});
    expect(res.error.code).toBe("BAD_INPUT");
  });
});

describe("mercadopago_resend_payment (identity-gated)", () => {
  it("returns the Pix code once the email matches the payer", async () => {
    mockFetch([{ path: "/v1/payments/1111111111", reply: () => pixPending() }]);
    const res = await server.call("mercadopago_resend_payment", {
      payment_id: "1111111111",
      email: " ana@example.com ",
    });
    expect(res.data).toMatchObject({ found: true, matchedBy: "email", method: "pix" });
    expect(res.data.pixCopyPaste).toMatch(/^000201/);
    expect(res.data.paymentUrl).toMatch(/^https:\/\/www\.mercadopago\.com\.br\//);
  });

  it("matches on phone too", async () => {
    mockFetch([{ path: "/v1/payments/1111111111", reply: () => pixPending() }]);
    const res = await server.call("mercadopago_resend_payment", {
      payment_id: "1111111111",
      phone: "+55 11 98765-4321",
    });
    expect(res.data.matchedBy).toBe("phone");
  });

  it("returns nothing on a mismatch, without identity, or with no payer data", async () => {
    mockFetch([
      { path: "/v1/payments/1111111111", reply: () => pixPending() },
      { path: "/v1/payments/3333333333", reply: () => pixPending({ id: 3333333333, payer: {} }) },
    ]);
    const mismatch = await server.call("mercadopago_resend_payment", {
      payment_id: "1111111111",
      email: "someone@else.com",
    });
    expect(mismatch.error.details.reason).toBe("IDENTITY_MISMATCH");
    expect(mismatch.text).not.toContain("000201");

    const none = await server.call("mercadopago_resend_payment", { payment_id: "1111111111" });
    expect(none.error.code).toBe("BAD_INPUT");

    const noPayer = await server.call("mercadopago_resend_payment", {
      payment_id: "3333333333",
      email: "ana@example.com",
    });
    expect(noPayer.error.details.reason).toBe("NO_PAYER_IDENTITY");
  });

  it("does not resend a paid or expired code", async () => {
    mockFetch([
      { path: "/v1/payments/1", reply: () => pixPending({ id: 1, status: "approved" }) },
      {
        path: "/v1/payments/2",
        reply: () => pixPending({ id: 2, date_of_expiration: iso(Date.now() - 1000) }),
      },
    ]);
    const paid = await server.call("mercadopago_resend_payment", {
      payment_id: "1",
      email: "ana@example.com",
    });
    expect(paid.data).toMatchObject({ found: false });
    expect(paid.text).not.toContain("000201");
    const expired = await server.call("mercadopago_resend_payment", {
      payment_id: "2",
      email: "ana@example.com",
    });
    expect(expired.data.found).toBe(false);
    expect(expired.data.message).toMatch(/expired/);
  });
});

describe("mercadopago_refund (bounded, idempotent)", () => {
  it("refunds in full with an empty body, an idempotency key and in-process rendering", async () => {
    const { calls } = mockFetch([
      { path: "/v1/payments/2222222222", reply: () => cardApproved() },
      {
        method: "POST",
        path: "/v1/payments/2222222222/refunds",
        reply: () => ({
          status: 201,
          body: {
            id: 9001,
            amount: 100,
            status: "approved",
            date_created: "2026-10-28T10:00:00.000-03:00",
          },
        }),
      },
    ]);
    const res = await server.call("mercadopago_refund", { payment_id: "2222222222" });
    expect(res.isError).toBe(false);
    expect(res.data.refund).toMatchObject({ refundId: "9001", status: "succeeded", amount: 100 });
    expect(res.data.note).toMatch(/card issuer/);
    const post = calls.find((c) => c.method === "POST");
    expect(post.body).toBeUndefined();
    expect(post.init.headers["X-Idempotency-Key"]).toMatch(/^hay-[0-9a-f]{40}$/);
    expect(post.init.headers["X-Render-In-Process-Refunds"]).toBe("true");
  });

  it("reports a Pix refund the bank has not confirmed as pending", async () => {
    mockFetch([
      {
        path: "/v1/payments/1111111111",
        reply: () => pixPending({ status: "approved", date_approved: iso(Date.now()) }),
      },
      {
        method: "POST",
        path: "/v1/payments/1111111111/refunds",
        reply: ({ body }) => ({
          status: 201,
          body: {
            id: 9002,
            amount: body.amount,
            status: "in_process",
            date_created: iso(Date.now()),
          },
        }),
      },
    ]);
    const res = await server.call("mercadopago_refund", { payment_id: "1111111111", amount: 50 });
    expect(res.data.refund.status).toBe("pending");
    expect(res.data.note).toMatch(/do not say the money has arrived/);
    expect(res.data.refundableAfter).toBe(149.9);
  });

  it("refuses more than what is left, before calling the refund endpoint", async () => {
    const { calls } = mockFetch([
      {
        path: "/v1/payments/2222222222",
        reply: () =>
          cardApproved({
            transaction_amount_refunded: 60,
            refunds: [
              {
                id: 1,
                amount: 60,
                status: "approved",
                date_created: "2026-10-21T10:00:00.000-03:00",
              },
            ],
          }),
      },
    ]);
    const res = await server.call("mercadopago_refund", { payment_id: "2222222222", amount: 50 });
    expect(res.error.code).toBe("PRECONDITION");
    expect(res.error.details).toMatchObject({ reason: "EXCEEDS_REFUNDABLE", refundable: 40 });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("counts a pending refund as already refunded", async () => {
    mockFetch([
      {
        path: "/v1/payments/2222222222",
        reply: () =>
          cardApproved({
            refunds: [
              {
                id: 1,
                amount: 100,
                status: "in_process",
                date_created: "2026-10-21T10:00:00.000-03:00",
              },
            ],
          }),
      },
    ]);
    const res = await server.call("mercadopago_refund", { payment_id: "2222222222" });
    expect(res.error.details.reason).toBe("ALREADY_REFUNDED");
  });

  it("does not refund twice when the same refund was just requested", async () => {
    const { calls } = mockFetch([
      {
        path: "/v1/payments/2222222222",
        reply: () =>
          cardApproved({
            transaction_amount_refunded: 0,
            refunds: [
              { id: 7, amount: 30, status: "in_process", date_created: iso(Date.now() - 60000) },
            ],
          }),
      },
    ]);
    const res = await server.call("mercadopago_refund", { payment_id: "2222222222", amount: 30 });
    expect(res.data.alreadyRequested).toBe(true);
    expect(res.data.refund.refundId).toBe("7");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("refuses unpaid and disputed payments", async () => {
    mockFetch([
      { path: "/v1/payments/1", reply: () => pixPending({ id: 1 }) },
      { path: "/v1/payments/2", reply: () => cardApproved({ id: 2, status: "charged_back" }) },
    ]);
    expect(
      (await server.call("mercadopago_refund", { payment_id: "1" })).error.details.reason,
    ).toBe("NOT_PAID");
    expect(
      (await server.call("mercadopago_refund", { payment_id: "2" })).error.details.reason,
    ).toBe("DISPUTE_OPEN");
  });

  it("calls a 5xx on the refund OUTCOME_UNKNOWN", async () => {
    mockFetch([
      { path: "/v1/payments/2222222222", reply: () => cardApproved() },
      {
        method: "POST",
        path: "/v1/payments/2222222222/refunds",
        reply: () => ({ status: 502, body: {} }),
      },
    ]);
    const res = await server.call("mercadopago_refund", { payment_id: "2222222222" });
    expect(res.error.code).toBe("OUTCOME_UNKNOWN");
  });
});

describe("mercadopago_refund_status", () => {
  it("lists refunds with honest notes", async () => {
    mockFetch([
      {
        path: "/v1/payments/2222222222",
        reply: () =>
          cardApproved({
            transaction_amount_refunded: 40,
            refunds: [
              {
                id: 1,
                amount: 40,
                status: "approved",
                date_created: "2026-10-21T10:00:00.000-03:00",
              },
              {
                id: 2,
                amount: 10,
                status: "in_process",
                date_created: "2026-10-22T10:00:00.000-03:00",
              },
            ],
          }),
      },
    ]);
    const res = await server.call("mercadopago_refund_status", { payment_id: "2222222222" });
    expect(res.data.paymentStatus).toBe("partially_refunded");
    expect(res.data.refundedAmount).toBe(50);
    expect(res.data.refunds.map((r) => r.status)).toEqual(["succeeded", "pending"]);
    const one = await server.call("mercadopago_refund_status", {
      payment_id: "2222222222",
      refund_id: "9",
    });
    expect(one.error.code).toBe("NOT_FOUND");
  });

  it("normalises a fully refunded payment", () => {
    const p = normalizePayment(
      cardApproved({ status: "refunded", transaction_amount_refunded: 100 }),
    );
    expect(p).toMatchObject({ status: "refunded", refundableAmount: 0 });
  });
});
