import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockShopify } = require("./harness");
const { registerPaymentTools } = require("../tools/payments");

function order(overrides = {}) {
  return {
    id: "gid://shopify/Order/1",
    name: "#1001",
    email: "ana@example.com",
    phone: null,
    cancelledAt: null,
    displayFinancialStatus: "PENDING",
    totalOutstandingSet: { shopMoney: { amount: "99.90", currencyCode: "BRL" } },
    billingAddress: { phone: "+55 11 98765-4321" },
    shippingAddress: null,
    customer: null,
    ...overrides,
  };
}

function handlers(o) {
  return {
    PaymentLinkContext: () => ({ order: o }),
    SendPaymentLink: (vars) => ({
      orderInvoiceSend: { order: { id: vars.id, name: "#1001" }, userErrors: [] },
    }),
  };
}

describe("shopify_send_payment_link", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerPaymentTools(server);
  });

  it("sends the invoice to the order's email once the phone matches", async () => {
    const { calls } = mockShopify(handlers(order()));
    const res = await server.call("shopify_send_payment_link", {
      order_id: "1",
      phone: "11987654321",
    });
    expect(res.data).toMatchObject({ sent: true, sentTo: "ana@example.com", matchedBy: "phone" });
    const send = calls.find((c) => c.op === "SendPaymentLink");
    expect(send.variables).toEqual({ id: "gid://shopify/Order/1" });
  });

  it("sends nothing when the identity does not match", async () => {
    const { calls } = mockShopify(handlers(order()));
    const res = await server.call("shopify_send_payment_link", {
      order_id: "1",
      email: "eve@example.com",
    });
    expect(res.data.details.reason).toBe("IDENTITY_MISMATCH");
    expect(calls.map((c) => c.op)).not.toContain("SendPaymentLink");
  });

  it("refuses unless payment is pending", async () => {
    const { calls } = mockShopify(handlers(order({ displayFinancialStatus: "PAID" })));
    const res = await server.call("shopify_send_payment_link", {
      order_id: "1",
      email: "ana@example.com",
    });
    expect(res.data.details.reason).toBe("NOT_PENDING");
    expect(calls.map((c) => c.op)).not.toContain("SendPaymentLink");
  });

  it("requires an email or phone first", async () => {
    const { calls } = mockShopify(handlers(order()));
    const res = await server.call("shopify_send_payment_link", { order_id: "1" });
    expect(res.data.code).toBe("BAD_INPUT");
    expect(calls).toHaveLength(0);
  });
});
