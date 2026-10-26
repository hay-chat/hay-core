import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { magentoApi, MagentoApiError } = require("../lib/client");

process.env.MAGENTO_BASE_URL = "https://store.test/rest/V1/";
process.env.MAGENTO_API_TOKEN = "tok";

function timeoutError() {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

describe("magentoApi", () => {
  it("never retries a POST that timed out (it may have been processed)", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      throw timeoutError();
    };
    await expect(magentoApi("POST", "/invoice/31/refund", { body: {} })).rejects.toThrow(/timeout/);
    expect(n).toBe(1);
  });

  it("retries a GET that timed out and sends the bearer token", async () => {
    let n = 0;
    let seen;
    global.fetch = async (url, init) => {
      n += 1;
      seen = { url: String(url), init };
      if (n === 1) throw timeoutError();
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => "true" };
    };
    expect(await magentoApi("GET", "/orders/1")).toBe(true);
    expect(n).toBe(2);
    expect(seen.url).toBe("https://store.test/rest/V1/orders/1");
    expect(seen.init.headers.Authorization).toBe("Bearer tok");
  }, 10000);

  it("does not retry a 5xx POST and substitutes Magento's message parameters", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      return {
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ message: "Could not refund %1.", parameters: ["invoice 31"] }),
      };
    };
    try {
      await magentoApi("POST", "/invoice/31/refund", { body: {} });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MagentoApiError);
      expect(err.status).toBe(500);
      expect(err.message).toMatch(/Could not refund invoice 31\./);
    }
    expect(n).toBe(1);
  });
});
