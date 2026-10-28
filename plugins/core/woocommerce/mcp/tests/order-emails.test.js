import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerOrderEmailTools } = require("../tools/order-emails");

process.env.WORDPRESS_SITE_URL = "https://store.test/";
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs";

const WC = "/wp-json/wc/v3";
const ORDER = { id: 12, number: "12", status: "processing", billing: { email: "ana@example.com" } };

describe("woocommerce_resend_order_confirmation", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerOrderEmailTools(server);
  });

  it("asks WooCommerce to resend the order details to the billing email, without overriding it", async () => {
    const { calls } = mockFetch([
      { method: "GET", path: `${WC}/orders/12`, reply: () => ORDER },
      {
        method: "POST",
        path: `${WC}/orders/12/actions/send_order_details`,
        reply: () => ({ message: "Billing email sent to ana@example.com." }),
      },
    ]);
    const res = await server.call("woocommerce_resend_order_confirmation", { order_id: "12" });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ sent: true, sentTo: "ana@example.com" });
    const post = calls.find((c) => c.method === "POST");
    expect(post.body).toEqual({});
    expect(post.body).not.toHaveProperty("force_email_update");
    expect(post.body).not.toHaveProperty("email");
  });

  it("explains when the store's WooCommerce is too old for the endpoint", async () => {
    mockFetch([
      { method: "GET", path: `${WC}/orders/12`, reply: () => ORDER },
      {
        method: "POST",
        path: `${WC}/orders/12/actions/send_order_details`,
        reply: () => ({ status: 404, body: { code: "rest_no_route", message: "No route" } }),
      },
    ]);
    const res = await server.call("woocommerce_resend_order_confirmation", { order_id: "12" });
    expect(res.isError).toBe(true);
    expect(res.error.code).toBe("PRECONDITION");
    expect(res.error.details.reason).toBe("UNSUPPORTED_WC_VERSION");
  });

  it("refuses when the order has no billing email", async () => {
    const { calls } = mockFetch([
      { method: "GET", path: `${WC}/orders/12`, reply: () => ({ ...ORDER, billing: {} }) },
    ]);
    const res = await server.call("woocommerce_resend_order_confirmation", { order_id: "12" });
    expect(res.error.details.reason).toBe("NO_EMAIL");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});
