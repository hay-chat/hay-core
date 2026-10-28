import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fx = require("./fixtures/pix-meta");
const { parsePix, parsePaymentReferences } = require("../lib/pix");
const { enrichOrder } = require("../lib/orders");

describe("parsePix (D10-2)", () => {
  it.each([
    ["mercadopago", fx.mercadopago, { qrImageUrl: null, expiresAt: null }],
    [
      "pagbank",
      fx.pagbank,
      {
        qrImageUrl: "https://api.pagseguro.com/qrcode/QRCO_1/png",
        expiresAt: "2026-10-31T02:59:00.000Z",
        expiresAtIsLocal: false,
      },
    ],
    [
      "pagbank_connect",
      fx.pagbankConnect,
      {
        qrImageUrl: "https://sandbox.api.pagseguro.com/qrcode/QRCO_2/png",
        expiresAt: "2026-10-30T23:59:00",
        expiresAtIsLocal: true,
      },
    ],
    [
      "pagarme",
      fx.pagarme,
      {
        qrImageUrl: expect.stringMatching(/^https:\/\/api\.pagar\.me\//),
        expiresAt: "2026-10-30T23:59:00.000Z",
      },
    ],
    [
      "asaas",
      fx.asaas,
      // Naive store-local time: returned unchanged and flagged, never shifted by the server zone.
      { qrImageUrl: null, expiresAt: "2026-10-30T23:59:59", expiresAtIsLocal: true },
    ],
  ])("reads the %s plugin's meta", (provider, meta, extra) => {
    expect(parsePix(meta)).toMatchObject({ provider, copyPaste: fx.CODE, ...extra });
  });

  it("never returns base64 images, non-URL images or non-Pix strings", () => {
    expect(parsePix([{ key: "_pagbank_pix_text", value: "not a pix code" }])).toBeNull();
    expect(
      parsePix([
        { key: "_pagbank_pix_text", value: fx.CODE },
        { key: "_pagbank_pix_qr_code", value: "data:image/png;base64,AAAA" },
      ]).qrImageUrl,
    ).toBeNull();
  });

  it("ignores meta outside the allowlist", () => {
    expect(parsePix([{ key: "some_other_pix", value: fx.CODE }])).toBeNull();
    expect(parsePix(undefined)).toBeNull();
  });
});

describe("enrichOrder payment fields (D10-2)", () => {
  const base = {
    id: 5,
    number: "5",
    currency: "BRL",
    total: "99.90",
    payment_method: "woo-mercado-pago-pix",
    payment_method_title: "Pix",
    transaction_id: "1234567890",
    created_via: "checkout",
    payment_url: "https://store.test/checkout/order-pay/5/?pay_for_order=true&key=wc_order_x",
    meta_data: fx.mercadopago,
    refunds: [],
  };

  it("exposes the payment link and Pix block while the order is unpaid", () => {
    const e = enrichOrder({ ...base, status: "pending", needs_payment: true, date_paid: null }, []);
    expect(e).toMatchObject({
      paymentMethodId: "woo-mercado-pago-pix",
      transactionId: "1234567890",
      needsPayment: true,
      createdVia: "checkout",
      paymentUrl: base.payment_url,
      pix: { provider: "mercadopago", copyPaste: fx.CODE },
    });
  });

  it("hides the spent Pix code and payment link once paid", () => {
    const e = enrichOrder(
      { ...base, status: "processing", needs_payment: false, date_paid: "2026-10-01T10:00:00" },
      [],
    );
    expect(e).toMatchObject({ needsPayment: false, paymentUrl: null, pix: null });
  });

  it("keeps the Mercado Pago payment ids on a paid order (D10-7), from the allowlisted key only", () => {
    const e = enrichOrder(
      {
        ...base,
        status: "processing",
        needs_payment: false,
        date_paid: "2026-10-01T10:00:00",
        meta_data: [
          { key: "_Mercado_Pago_Payment_IDs", value: "1325046583, 1325046590" },
          { key: "_mp_access_token", value: "APP_USR-secret" },
        ],
      },
      [],
    );
    expect(e.paymentReferences).toEqual([
      { provider: "mercadopago", paymentId: "1325046583" },
      { provider: "mercadopago", paymentId: "1325046590" },
    ]);
    expect(JSON.stringify(e)).not.toContain("APP_USR-secret");
  });

  it("dates refunds from the refund list", () => {
    const e = enrichOrder(
      {
        ...base,
        status: "completed",
        date_paid: "2026-10-01T10:00:00",
        refunds: [{ id: 30, reason: "", total: "-10.00" }],
      },
      [],
      { refundDetails: [{ id: 30, date_created: "2026-10-04T09:00:00" }] },
    );
    expect(e.refunds).toEqual([
      { id: 30, reason: "", total: "-10.00", dateCreated: "2026-10-04T09:00:00" },
    ]);
  });
});

describe("parsePaymentReferences (D10-7)", () => {
  it("ignores junk, duplicates and unknown keys", () => {
    expect(
      parsePaymentReferences([
        { key: "_Mercado_Pago_Payment_IDs", value: "abc, 12, 1325046583,1325046583" },
        { key: "payment_id", value: "9999999999" },
      ]),
    ).toEqual([{ provider: "mercadopago", paymentId: "1325046583" }]);
    expect(parsePaymentReferences(undefined)).toEqual([]);
  });
});
