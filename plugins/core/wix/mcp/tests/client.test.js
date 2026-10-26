import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { wixApi, WixApiError } = require("../lib/client");

process.env.WIX_API_KEY = "test-key";
process.env.WIX_SITE_ID = "site-1";

function timeoutError() {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

describe("wixApi", () => {
  it("sends the raw API key, the site id header and a JSON body", async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" };
    };
    await wixApi("POST", "/ecom/v1/orders/search", { body: { search: {} } });
    expect(calls[0].url).toBe("https://www.wixapis.com/ecom/v1/orders/search");
    expect(calls[0].init.headers.Authorization).toBe("test-key");
    expect(calls[0].init.headers["wix-site-id"]).toBe("site-1");
    expect(JSON.parse(calls[0].init.body)).toEqual({ search: {} });
  });

  it("never retries a POST that timed out (it may have been processed)", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      throw timeoutError();
    };
    await expect(
      wixApi("POST", "/ecom/v1/order-billing/refund-payments", { body: {} }),
    ).rejects.toThrow(/timeout/);
    expect(n).toBe(1);
  });

  it("retries a GET that timed out", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      if (n === 1) throw timeoutError();
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" };
    };
    expect(await wixApi("GET", "/ecom/v1/orders/x")).toEqual({});
    expect(n).toBe(2);
  }, 10000);

  it("does not retry a 5xx POST and surfaces the Wix error body", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      return {
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ details: { applicationError: { description: "boom", code: "X" } } }),
      };
    };
    try {
      await wixApi("POST", "/ecom/v1/orders/x/cancel", { body: {} });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WixApiError);
      expect(err.status).toBe(500);
      expect(err.message).toMatch(/boom \(X\)/);
    }
    expect(n).toBe(1);
  });
});
