import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BASE } = require("./fixtures");
const { mockFetch } = require("./harness");
const { nsApi, nsList, NuvemshopApiError } = require("../lib/client");

describe("nsApi", () => {
  it("sends the nonstandard Authentication header, a User-Agent, and the store path", async () => {
    const { calls } = mockFetch([
      { method: "GET", path: `${BASE}/orders`, reply: () => [{ id: 1 }] },
    ]);
    const data = await nsApi("GET", "/orders", {
      query: { q: "101", skip: undefined, ids: ["1", "2"] },
    });
    expect(data).toEqual([{ id: 1 }]);
    expect(calls[0].url.origin).toBe("https://api.nuvemshop.com.br");
    expect(calls[0].init.headers.Authentication).toBe("bearer tok");
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(calls[0].init.headers["User-Agent"]).toMatch(/Hay/);
    expect(calls[0].query.get("ids")).toBe("1,2");
    expect(calls[0].query.has("skip")).toBe(false);
  });

  it("does not retry a POST on a 500", async () => {
    const { calls } = mockFetch([
      {
        method: "POST",
        path: `${BASE}/coupons`,
        reply: () => ({ status: 500, body: { description: "boom" } }),
      },
    ]);
    await expect(nsApi("POST", "/coupons", { body: {} })).rejects.toThrow(/HTTP 500: boom/);
    expect(calls).toHaveLength(1);
  });

  it("does not retry a POST whose fetch times out", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      throw new Error("The operation was aborted due to timeout");
    };
    await expect(nsApi("POST", "/orders/1/cancel", { body: {} })).rejects.toThrow(/timeout/);
    expect(n).toBe(1);
  });

  it("retries a GET on a 5xx", async () => {
    let n = 0;
    mockFetch([
      {
        method: "GET",
        path: `${BASE}/store`,
        reply: () => (++n < 2 ? { status: 503, body: {} } : { id: 1 }),
      },
    ]);
    await expect(nsApi("GET", "/store")).resolves.toEqual({ id: 1 });
    expect(n).toBe(2);
  });

  it("retries any method on 429, honouring X-Rate-Limit-Reset", async () => {
    let n = 0;
    mockFetch([
      {
        method: "POST",
        path: `${BASE}/coupons`,
        reply: () =>
          ++n < 2 ? { status: 429, body: {}, headers: { "X-Rate-Limit-Reset": "5" } } : { id: 3 },
      },
    ]);
    await expect(nsApi("POST", "/coupons", { body: {} })).resolves.toEqual({ id: 3 });
    expect(n).toBe(2);
  });

  it("explains 401 and 402", async () => {
    mockFetch([
      { method: "GET", path: `${BASE}/store`, reply: () => ({ status: 401, body: {} }) },
      { method: "GET", path: `${BASE}/orders`, reply: () => ({ status: 402, body: {} }) },
    ]);
    await expect(nsApi("GET", "/store")).rejects.toThrow(/reconnect the plugin/);
    const err = await nsApi("GET", "/orders").catch((e) => e);
    expect(err).toBeInstanceOf(NuvemshopApiError);
    expect(err.status).toBe(402);
    expect(err.message).toMatch(/subscription is unpaid/);
  });

  it("nsList treats a 404 past the last page as an empty page and reads X-Total-Count", async () => {
    mockFetch([
      {
        method: "GET",
        path: `${BASE}/products`,
        reply: ({ query }) =>
          query.get("page") === "2"
            ? { status: 404, body: { description: "Last page is 1" } }
            : { status: 200, body: [{ id: 1 }], headers: { "X-Total-Count": "1" } },
      },
    ]);
    await expect(nsList("/products", { page: 1 })).resolves.toEqual({
      items: [{ id: 1 }],
      total: 1,
    });
    await expect(nsList("/products", { page: 2 })).resolves.toEqual({ items: [], total: null });
  });
});
