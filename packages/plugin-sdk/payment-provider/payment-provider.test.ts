import { describe, it, expect } from "vitest";
import {
  contractToolNames,
  contractToolRisk,
  toCents,
  refundBound,
  refundIdempotencyKey,
  findDuplicateRefund,
  assertPaymentShape,
} from "./index.cjs";
import { normalizeToolRiskSpec } from "../tool-risk/index.cjs";

describe("payment_provider contract", () => {
  it("names the five tools under the provider prefix", () => {
    expect(contractToolNames("mercadopago")).toEqual({
      get_payment: "mercadopago_get_payment",
      find_payments: "mercadopago_find_payments",
      resend_payment: "mercadopago_resend_payment",
      refund: "mercadopago_refund",
      refund_status: "mercadopago_refund_status",
    });
    expect(() => contractToolNames("Mercado-Pago")).toThrow();
  });

  it("makes refund the only write, as a held refund", () => {
    const spec = contractToolRisk("asaas");
    expect(spec.write).toEqual({ asaas_refund: "refund" });
    expect(spec.read).toHaveLength(4);
    expect(() => normalizeToolRiskSpec(spec)).not.toThrow();
  });

  it("converts amounts to cents without float drift", () => {
    expect(toCents("19.90")).toBe(1990);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-1)).toBeNull();
    expect(toCents("abc")).toBeNull();
  });
});

describe("refundBound", () => {
  it("defaults to the full remaining amount", () => {
    expect(refundBound({ paidCents: 10000, refundedCents: 0 })).toEqual({
      amountCents: 10000,
      remainingCents: 10000,
      full: true,
    });
    expect(refundBound({ paidCents: 10000, refundedCents: 2500 })).toMatchObject({
      amountCents: 7500,
      full: false,
    });
  });

  it("refuses more than what is left, zero, and a fully refunded payment", () => {
    expect(() =>
      refundBound({ paidCents: 10000, refundedCents: 2500, requestedCents: 8000 }),
    ).toThrow(
      expect.objectContaining({
        code: "PRECONDITION",
        details: expect.objectContaining({ reason: "EXCEEDS_REFUNDABLE" }),
      }),
    );
    expect(() => refundBound({ paidCents: 10000, refundedCents: 0, requestedCents: 0 })).toThrow(
      expect.objectContaining({ code: "BAD_INPUT" }),
    );
    expect(() => refundBound({ paidCents: 10000, refundedCents: 10000 })).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ reason: "ALREADY_REFUNDED" }) }),
    );
    expect(() => refundBound({ paidCents: 0, refundedCents: 0 })).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ reason: "NOTHING_PAID" }) }),
    );
  });
});

describe("refund idempotency", () => {
  it("gives the same key for the same request and state, a new one after a refund lands", () => {
    const a = refundIdempotencyKey({
      provider: "mp",
      paymentId: "1",
      amountCents: 500,
      refundedCentsBefore: 0,
    });
    const b = refundIdempotencyKey({
      provider: "mp",
      paymentId: "1",
      amountCents: 500,
      refundedCentsBefore: 0,
    });
    const c = refundIdempotencyKey({
      provider: "mp",
      paymentId: "1",
      amountCents: 500,
      refundedCentsBefore: 500,
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBeLessThanOrEqual(64);
  });

  it("spots a same-amount refund created moments ago, ignoring failed and old ones", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    const refunds = [
      { amountCents: 500, status: "failed", createdAt: "2026-10-28T11:59:00Z" },
      { amountCents: 500, status: "pending", createdAt: "2026-10-28T10:00:00Z" },
      { amountCents: 700, status: "pending", createdAt: "2026-10-28T11:59:00Z" },
    ];
    expect(findDuplicateRefund(refunds, 500, { now })).toBeNull();
    const recent = { amountCents: 500, status: "pending", createdAt: "2026-10-28T11:58:00Z" };
    expect(findDuplicateRefund([...refunds, recent], 500, { now })).toBe(recent);
  });
});

describe("assertPaymentShape", () => {
  it("accepts a normalised payment and rejects one carrying a Pix code", () => {
    const p = {
      provider: "mercadopago",
      paymentId: "1",
      status: "paid",
      method: "pix",
      amount: 10,
      refundedAmount: 0,
      refundableAmount: 10,
      currency: "BRL",
      refunds: [],
    };
    expect(assertPaymentShape(p)).toEqual([]);
    expect(assertPaymentShape({ ...p, status: "approved", pixCopyPaste: "000201" })).toHaveLength(
      2,
    );
  });
});
