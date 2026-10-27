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
      /WooCommerce refused: Gateway said no\. \(woocommerce_rest_cannot_create_order_refund\)/,
    );
    expect(calls).toHaveLength(1);
    let caught;
    try {
      await wcApi("POST", "/orders/1/refunds", { body: {} });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WooApiError);
    expect(caught.status).toBe(500);
    expect(caught.wooCode).toBe("woocommerce_rest_cannot_create_order_refund");
    // A structured WordPress error on a write is a definite "no", not an unknown outcome.
    expect(caught.code).toBe("PROVIDER_REFUSED");
    expect(caught.retryable).toBe(false);
  });

  it("never retries a POST that timed out (it may have been processed)", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    };
    await expect(wcApi("POST", "/orders/1/refunds", { body: {} })).rejects.toMatchObject({
      code: "OUTCOME_UNKNOWN",
      retryable: false,
      details: { cause: expect.stringMatching(/timeout/) },
    });
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

describe("WooCommerce error codes", () => {
  function replyOnce(method, status, body) {
    return mockFetch([{ method, path: `${WC}/orders/1`, reply: () => ({ status, body }) }]);
  }

  it("maps a write with a read-only key to SCOPE_MISSING", async () => {
    replyOnce("PUT", 401, {
      code: "woocommerce_rest_cannot_edit",
      message: "Sorry, you are not allowed to edit this resource.",
    });
    await expect(wcApi("PUT", "/orders/1", { body: {} })).rejects.toMatchObject({
      code: "SCOPE_MISSING",
      status: 401,
    });
  });

  it("maps a rejected key to AUTH_FAILED with a reconnect message", async () => {
    replyOnce("GET", 401, {
      code: "woocommerce_rest_authentication_error",
      message: "Invalid signature",
    });
    const err = await wcApi("GET", "/orders/1").catch((e) => e);
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.message).toMatch(/reconnect WooCommerce in Hay\.chat/);
  });

  it("maps a missing record to NOT_FOUND and invalid params to BAD_INPUT", async () => {
    replyOnce("GET", 404, {
      code: "woocommerce_rest_shop_order_invalid_id",
      message: "Invalid ID.",
    });
    await expect(wcApi("GET", "/orders/1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    replyOnce("PUT", 400, { code: "rest_invalid_param", message: "Invalid parameter(s): status" });
    await expect(wcApi("PUT", "/orders/1", { body: {} })).rejects.toMatchObject({
      code: "BAD_INPUT",
    });
  });

  it("treats a write that got an unstructured 5xx as OUTCOME_UNKNOWN, never retried", async () => {
    const { calls } = mockFetch([
      { method: "PUT", path: `${WC}/orders/1`, reply: () => ({ status: 502, body: null }) },
    ]);
    await expect(wcApi("PUT", "/orders/1", { body: {} })).rejects.toMatchObject({
      code: "OUTCOME_UNKNOWN",
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("gives up on a GET after retries with retryable PROVIDER_DOWN", async () => {
    mockFetch([
      { method: "GET", path: `${WC}/orders/1`, reply: () => ({ status: 503, body: null }) },
    ]);
    await expect(wcApi("GET", "/orders/1")).rejects.toMatchObject({
      code: "PROVIDER_DOWN",
      retryable: true,
    });
  }, 15000);

  it("returns retryable RATE_LIMITED after repeated 429s", async () => {
    mockFetch([
      { method: "POST", path: `${WC}/orders/1`, reply: () => ({ status: 429, body: null }) },
    ]);
    await expect(wcApi("POST", "/orders/1", { body: {} })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  }, 15000);
});
