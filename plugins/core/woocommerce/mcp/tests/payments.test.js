import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerPaymentTools, expiryMs } = require("../tools/payments");

process.env.WORDPRESS_SITE_URL = "https://store.test/";
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs";

const WC = "/wp-json/wc/v3";
const PIX =
  "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR";

function order(overrides = {}) {
  return {
    id: 30,
    number: "30",
    status: "pending",
    needs_payment: true,
    date_paid: null,
    total: "99.90",
    currency: "BRL",
    date_created: "2026-10-27T10:00:00",
    date_created_gmt: "2026-10-27T13:00:00",
    payment_url: "https://store.test/checkout/order-pay/30/?pay_for_order=true&key=wc_order_x",
    billing: { email: "ana@example.com", phone: "(11) 98765-4321" },
    shipping: { phone: "" },
    meta_data: [
      { key: "_pagbank_pix_text", value: PIX },
      { key: "_pagbank_pix_expiration_date", value: "2099-01-01T00:00:00-03:00" },
    ],
    ...overrides,
  };
}

const routes = (o) => [{ method: "GET", path: `${WC}/orders/30`, reply: () => o }];

describe("woocommerce_resend_pix", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerPaymentTools(server);
  });

  it("returns the valid Pix code once the email matches", async () => {
    mockFetch(routes(order()));
    const res = await server.call("woocommerce_resend_pix", {
      order_id: "30",
      email: "ANA@example.com",
    });
    expect(res.data).toMatchObject({
      found: true,
      method: "pix",
      pixCopyPaste: PIX,
      matchedBy: "email",
    });
  });

  it("falls back to the payment link when the Pix code expired", async () => {
    mockFetch(
      routes(
        order({
          meta_data: [
            { key: "_pagbank_pix_text", value: PIX },
            { key: "_pagbank_pix_expiration_date", value: "2020-01-01T00:00:00-03:00" },
          ],
        }),
      ),
    );
    const res = await server.call("woocommerce_resend_pix", {
      order_id: "30",
      phone: "+55 11 98765 4321",
    });
    expect(res.data).toMatchObject({
      found: true,
      method: "payment_link",
      pixExpired: true,
      matchedBy: "phone",
    });
    expect(res.data.pixCopyPaste).toBeUndefined();
  });

  it("shares nothing when the identity does not match", async () => {
    mockFetch(routes(order()));
    const res = await server.call("woocommerce_resend_pix", {
      order_id: "30",
      email: "eve@example.com",
    });
    expect(res.isError).toBe(true);
    expect(res.error.details.reason).toBe("IDENTITY_MISMATCH");
    expect(res.text).not.toContain(PIX);
  });

  it("requires an email or phone before reading the order", async () => {
    const { calls } = mockFetch(routes(order()));
    const res = await server.call("woocommerce_resend_pix", { order_id: "30" });
    expect(res.error.code).toBe("BAD_INPUT");
    expect(calls).toHaveLength(0);
  });

  it("sends nothing for a paid or cancelled order", async () => {
    mockFetch(
      routes(
        order({ status: "processing", needs_payment: false, date_paid: "2026-10-27T10:05:00" }),
      ),
    );
    const paid = await server.call("woocommerce_resend_pix", {
      order_id: "30",
      email: "ana@example.com",
    });
    expect(paid.data).toMatchObject({ found: false });
    expect(paid.text).not.toContain(PIX);
    mockFetch(routes(order({ status: "cancelled", needs_payment: false })));
    const cancelled = await server.call("woocommerce_resend_pix", {
      order_id: "30",
      email: "ana@example.com",
    });
    expect(cancelled.data.found).toBe(false);
  });

  it("reads a store-local expiry with the store's offset", () => {
    const ms = expiryMs({ expiresAt: "2026-10-27T12:00:00", expiresAtIsLocal: true }, order());
    expect(new Date(ms).toISOString()).toBe("2026-10-27T15:00:00.000Z");
  });
});
