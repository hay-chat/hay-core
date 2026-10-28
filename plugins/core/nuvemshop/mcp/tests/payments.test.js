import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeOrder, orderRoutes } = require("./fixtures");
const { createFakeServer, mockFetch } = require("./harness");
const { registerPaymentTools, pickPaymentResource } = require("../tools/payments");

let server;
beforeEach(() => {
  server = createFakeServer();
  registerPaymentTools(server);
});

const unpaid = () => makeOrder({ payment_status: "pending", paid_at: null });
const future = new Date(Date.now() + 3600e3).toISOString();
const pixTx = (overrides = {}) => ({
  id: "t1",
  status: "pending",
  created_at: "2026-10-27T10:00:00Z",
  payment_method: { type: "pix" },
  info: {
    external_resource_url: "https://pay.test/qr.png",
    external_resource_code: "00020126PIXCODE",
    external_resource_expires_at: future,
  },
  ...overrides,
});

describe("nuvemshop_get_payment_link", () => {
  it("requires an email or phone before looking anything up", async () => {
    const { calls } = mockFetch(orderRoutes(unpaid()));
    const res = await server.call("nuvemshop_get_payment_link", { order_id: "900" });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("shares nothing when the identity does not match the order", async () => {
    mockFetch(orderRoutes(unpaid(), { transactions: [pixTx()] }));
    const res = await server.call("nuvemshop_get_payment_link", {
      order_id: "900",
      email: "mallory@example.com",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/does not match/);
    expect(res.error.code).toBe("PRECONDITION");
    expect(res.text).not.toMatch(/PIXCODE/);
  });

  it("returns the Pix code once the phone matches (formatting-proof)", async () => {
    mockFetch(orderRoutes(unpaid(), { transactions: [pixTx()] }));
    const res = await server.call("nuvemshop_get_payment_link", {
      order_number: "101",
      phone: "(11) 91234 5678",
    });
    expect(res.data).toMatchObject({
      found: true,
      matchedBy: "phone",
      paymentMethod: "pix",
      paymentUrl: "https://pay.test/qr.png",
      paymentCode: "00020126PIXCODE",
    });
  });

  it("says found=false (hand off) when transactions are not exposed or the code expired", async () => {
    mockFetch(orderRoutes(unpaid()));
    let res = await server.call("nuvemshop_get_payment_link", {
      order_id: "900",
      email: "ANA@example.com",
    });
    expect(res.data).toMatchObject({ found: false, matchedBy: "email" });
    expect(res.data.message).toMatch(/Hand off/);

    mockFetch(
      orderRoutes(unpaid(), {
        transactions: [
          pixTx({
            info: {
              external_resource_code: "X",
              external_resource_expires_at: "2020-01-01T00:00:00Z",
            },
          }),
        ],
      }),
    );
    res = await server.call("nuvemshop_get_payment_link", {
      order_id: "900",
      email: "ana@example.com",
    });
    expect(res.data).toMatchObject({ found: false, expiredAt: "2020-01-01T00:00:00Z" });
  });

  it("does not offer a link for paid or cancelled orders", async () => {
    mockFetch(orderRoutes(makeOrder(), { transactions: [pixTx()] }));
    let res = await server.call("nuvemshop_get_payment_link", {
      order_id: "900",
      email: "ana@example.com",
    });
    expect(res.data).toMatchObject({ found: false, paymentStatus: "paid" });

    mockFetch(orderRoutes(makeOrder({ status: "cancelled", payment_status: "pending" })));
    res = await server.call("nuvemshop_get_payment_link", {
      order_id: "900",
      email: "ana@example.com",
    });
    expect(res.text).toMatch(/cancelled/);
  });
});

describe("pickPaymentResource", () => {
  it("ignores captured transactions and card payments", () => {
    expect(pickPaymentResource([pixTx({ status: "paid" })])).toBeNull();
    expect(pickPaymentResource([pixTx({ payment_method: { type: "credit_card" } })])).toBeNull();
    expect(pickPaymentResource(null)).toBeNull();
  });
});
