import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mockShopify } = require("./harness");
const { shopifyGql, isMutation } = require("../lib/client");
const { fail, assertNoUserErrors } = require("../lib/format");

const QUERY = `query GetThing($id: ID!) { order(id: $id) { id } }`;
const MUTATION = `
  mutation DoThing($id: ID!) {
    orderUpdate(input: { id: $id }) { userErrors { field message } }
  }
`;

async function codeOf(promise) {
  try {
    await promise;
  } catch (err) {
    return JSON.parse(fail(err).content[0].text);
  }
  throw new Error("expected a rejection");
}

describe("isMutation", () => {
  it("tells mutations from queries", () => {
    expect(isMutation(MUTATION)).toBe(true);
    expect(isMutation(QUERY)).toBe(false);
    expect(isMutation("# comment\n  mutation X { a }")).toBe(true);
  });
});

describe("shopifyGql retry and error codes", () => {
  it("never retries a mutation that hit a network error or timeout (OUTCOME_UNKNOWN)", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    };
    const payload = await codeOf(shopifyGql(MUTATION, { id: "1" }));
    expect(n).toBe(1);
    expect(payload).toMatchObject({ code: "OUTCOME_UNKNOWN", retryable: false });
    expect(payload.message).toMatch(/did not confirm/);
  });

  it("never retries a mutation on a 5xx", async () => {
    const { calls } = mockShopify({ DoThing: () => ({ status: 502, body: "bad gateway" }) });
    const payload = await codeOf(shopifyGql(MUTATION, { id: "1" }));
    expect(calls).toHaveLength(1);
    expect(payload.code).toBe("OUTCOME_UNKNOWN");
  });

  it("retries a query on a 5xx, then succeeds", async () => {
    let n = 0;
    const { calls } = mockShopify({
      GetThing: () => (++n < 2 ? { status: 503, body: "busy" } : { order: { id: "1" } }),
    });
    expect(await shopifyGql(QUERY, { id: "1" })).toEqual({ order: { id: "1" } });
    expect(calls).toHaveLength(2);
  }, 10000);

  it("gives up on a query after 3 attempts with retryable PROVIDER_DOWN", async () => {
    const { calls } = mockShopify({ GetThing: () => ({ status: 500, body: "x" }) });
    const payload = await codeOf(shopifyGql(QUERY, { id: "1" }));
    expect(calls).toHaveLength(3);
    expect(payload).toMatchObject({ code: "PROVIDER_DOWN", retryable: true });
  }, 10000);

  it("retries a THROTTLED mutation (it was never executed)", async () => {
    let n = 0;
    const { calls } = mockShopify({
      DoThing: () =>
        ++n < 2
          ? { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }
          : { orderUpdate: { userErrors: [] } },
    });
    await shopifyGql(MUTATION, { id: "1" });
    expect(calls).toHaveLength(2);
  }, 10000);

  it("returns retryable RATE_LIMITED after repeated 429s", async () => {
    const { calls } = mockShopify({ DoThing: () => ({ status: 429, body: "slow down" }) });
    const payload = await codeOf(shopifyGql(MUTATION, { id: "1" }));
    expect(calls).toHaveLength(3);
    expect(payload).toMatchObject({ code: "RATE_LIMITED", retryable: true });
  }, 10000);

  it("maps 401 to AUTH_FAILED with a reconnect message", async () => {
    mockShopify({ GetThing: () => ({ status: 401, body: { errors: "Invalid API key" } }) });
    const payload = await codeOf(shopifyGql(QUERY, { id: "1" }));
    expect(payload).toMatchObject({ code: "AUTH_FAILED", retryable: false });
    expect(payload.message).toMatch(/reconnect Shopify in Hay\.chat/);
  });

  it("maps ACCESS_DENIED to SCOPE_MISSING and keeps Shopify's scope hint", async () => {
    mockShopify({
      GetThing: () => ({
        errors: [
          {
            message: "Access denied for returns field. Required access: `read_returns`",
            extensions: { code: "ACCESS_DENIED" },
          },
        ],
      }),
    });
    const payload = await codeOf(shopifyGql(QUERY, { id: "1" }));
    expect(payload.code).toBe("SCOPE_MISSING");
    expect(payload.message).toMatch(/read_returns/);
    expect(payload.message).toMatch(/re-approve Hay\.chat/);
    expect(payload.details.missingScopes).toEqual(["read_returns"]);
  });

  it("maps an invalid id to BAD_INPUT", async () => {
    mockShopify({
      GetThing: () => ({ errors: [{ message: "Invalid global id 'gid://shopify/Order/abc'" }] }),
    });
    expect((await codeOf(shopifyGql(QUERY, { id: "abc" }))).code).toBe("BAD_INPUT");
  });

  it("reports missing credentials as INTERNAL", async () => {
    const saved = process.env.SHOPIFY_ACCESS_TOKEN;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
    try {
      expect((await codeOf(shopifyGql(QUERY))).code).toBe("INTERNAL");
    } finally {
      process.env.SHOPIFY_ACCESS_TOKEN = saved;
    }
  });
});

describe("assertNoUserErrors", () => {
  it("throws PROVIDER_REFUSED with Shopify's reasons", () => {
    let thrown;
    try {
      assertNoUserErrors({ userErrors: [{ field: ["note"], message: "Note is too long" }] });
    } catch (err) {
      thrown = JSON.parse(fail(err).content[0].text);
    }
    expect(thrown).toMatchObject({
      code: "PROVIDER_REFUSED",
      retryable: false,
      message: "Shopify refused: Note is too long",
      details: { userErrors: [{ field: ["note"], message: "Note is too long" }] },
    });
  });
});
