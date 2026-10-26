import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mockFetch } = require("./harness");
const { wcApi, wcList, WooApiError } = require("../lib/client");

process.env.WORDPRESS_SITE_URL = "https://store.test/";
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs";

const WC = "/wp-json/wc/v3";

describe("wcApi", () => {
  it("adds credentials and query params, strips the trailing slash, and parses JSON", async () => {
    const { calls } = mockFetch([
      { method: "GET", path: `${WC}/orders`, reply: () => [{ id: 1 }] },
    ]);
    const data = await wcApi("GET", "/orders", {
      query: { per_page: 5, skip: undefined, tags: ["a", "b"] },
    });
    expect(data).toEqual([{ id: 1 }]);
    expect(calls[0].url.origin).toBe("https://store.test");
    expect(calls[0].query.get("consumer_secret")).toBe("cs");
    expect(calls[0].query.get("per_page")).toBe("5");
    expect(calls[0].query.get("tags")).toBe("a,b");
    expect(calls[0].query.has("skip")).toBe(false);
  });

  it("surfaces WooCommerce error code + message without retrying a failed POST", async () => {
    const { calls } = mockFetch([
      {
        method: "POST",
        path: `${WC}/orders/1/refunds`,
        reply: () => ({
          status: 500,
          body: {
            code: "woocommerce_rest_cannot_create_order_refund",
            message: "Gateway said no.",
          },
        }),
      },
    ]);
    await expect(wcApi("POST", "/orders/1/refunds", { body: {} })).rejects.toThrow(
      /HTTP 500: Gateway said no\. \(woocommerce_rest_cannot_create_order_refund\)/,
    );
    expect(calls).toHaveLength(1);
    try {
      await wcApi("POST", "/orders/1/refunds", { body: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(WooApiError);
      expect(err.status).toBe(500);
      expect(err.code).toBe("woocommerce_rest_cannot_create_order_refund");
    }
  });

  it("never retries a POST that timed out (it may have been processed)", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    };
    await expect(wcApi("POST", "/orders/1/refunds", { body: {} })).rejects.toThrow(/timeout/);
    expect(n).toBe(1);
  });

  it("retries a GET on 5xx and gives up with the last error", async () => {
    let n = 0;
    const { calls } = mockFetch([
      {
        method: "GET",
        path: `${WC}/orders/1`,
        reply: () => (++n < 2 ? { status: 503, body: { message: "busy" } } : { id: 1 }),
      },
    ]);
    expect(await wcApi("GET", "/orders/1")).toEqual({ id: 1 });
    expect(calls).toHaveLength(2);
  }, 10000);

  it("wcList reads pagination headers when present", async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: (k) => ({ "x-wp-total": "42", "x-wp-totalpages": "5" })[k] ?? null },
      text: async () => JSON.stringify([{ id: 1 }]),
    });
    expect(await wcList("/orders", { page: 1 })).toEqual({
      items: [{ id: 1 }],
      total: 42,
      totalPages: 5,
    });
  });

  it("uses an alternate namespace when asked", async () => {
    const { calls } = mockFetch([
      { method: "GET", path: "/wp-json/wc-ast/v3/orders/1/shipment-trackings", reply: () => [] },
    ]);
    await wcApi("GET", "/orders/1/shipment-trackings", { namespace: "wc-ast/v3" });
    expect(calls[0].path).toBe("/wp-json/wc-ast/v3/orders/1/shipment-trackings");
  });
});
