import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { meGet, MelhorEnvioApiError } = require("../lib/client");

function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

async function failure(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to fail");
}

beforeEach(() => {
  process.env.MELHOR_ENVIO_ACCESS_TOKEN = "tok";
  process.env.MELHOR_ENVIO_USER_AGENT = "Hay (dev@store.test)";
});

describe("meGet", () => {
  it("sends the bearer token and the User-Agent Melhor Envio requires", async () => {
    let seen;
    global.fetch = async (url, init) => {
      seen = { url: String(url), init };
      return reply(200, [{ id: "a" }]);
    };
    expect(await meGet("/api/v2/me/orders/search", { q: "ME1BR", empty: "" })).toEqual([
      { id: "a" },
    ]);
    expect(seen.url).toBe("https://melhorenvio.com.br/api/v2/me/orders/search?q=ME1BR");
    expect(seen.init.headers).toEqual({
      Authorization: "Bearer tok",
      Accept: "application/json",
      "User-Agent": "Hay (dev@store.test)",
    });
  });

  it("refuses to call without a token or a User-Agent", async () => {
    let called = false;
    global.fetch = async () => {
      called = true;
      return reply(200, []);
    };
    delete process.env.MELHOR_ENVIO_USER_AGENT;
    const err = await failure(meGet("/api/v2/me/orders"));
    expect(err.code).toBe("INTERNAL");
    expect(called).toBe(false);
  });

  it("retries a GET that timed out", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      if (n === 1) throw new Error("The operation was aborted due to timeout");
      return reply(200, { id: "a" });
    };
    expect(await meGet("/api/v2/me/orders/a")).toEqual({ id: "a" });
    expect(n).toBe(2);
  }, 10000);

  it("retries a 429 after Retry-After, then reports RATE_LIMITED", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      return reply(429, { message: "Too Many Attempts." }, { "retry-after": "0.01" });
    };
    const err = await failure(meGet("/api/v2/me/orders"));
    expect(n).toBe(4);
    expect(err).toBeInstanceOf(MelhorEnvioApiError);
    expect(err).toMatchObject({ code: "RATE_LIMITED", retryable: true, status: 429 });
  });

  it("maps 401 and 403 to reconnect instructions without retrying", async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      return reply(401, { message: "Unauthenticated." });
    };
    const unauthenticated = await failure(meGet("/api/v2/me/orders"));
    expect(unauthenticated).toMatchObject({ code: "AUTH_FAILED", retryable: false, status: 401 });
    expect(unauthenticated.message).toMatch(/generate a new token/);
    expect(n).toBe(1);

    global.fetch = async () => reply(403, { message: "Invalid scope(s) provided." });
    const forbidden = await failure(meGet("/api/v2/me/orders"));
    expect(forbidden.code).toBe("SCOPE_MISSING");
    expect(forbidden.message).toMatch(/orders-read/);
  });

  it("relays Melhor Envio's validation messages", async () => {
    global.fetch = async () =>
      reply(400, {
        message: "The given data was invalid.",
        errors: { "orders.0": ["O campo orders.0 deve ter pelo menos 36 caracteres."] },
      });
    const err = await failure(meGet("/api/v2/me/orders/x"));
    expect(err.code).toBe("BAD_INPUT");
    expect(err.message).toBe(
      "Melhor Envio refused: The given data was invalid. — O campo orders.0 deve ter pelo menos 36 caracteres.",
    );
    expect(err.notFound).toBe(false);
  });

  it("flags the two documented not-found answers", async () => {
    global.fetch = async () => reply(400, { error: "Not Found" });
    expect((await failure(meGet("/api/v2/me/orders/search", { q: "x" }))).notFound).toBe(true);

    global.fetch = async () => reply(404, { message: "No query results for model [App\\Order]." });
    const err = await failure(meGet("/api/v2/me/orders/x"));
    expect(err).toMatchObject({ code: "NOT_FOUND", notFound: true });
  });

  it("does not pass an HTML error page on to the agent", async () => {
    global.fetch = async () => reply(404, "<!DOCTYPE html><html>...</html>");
    const err = await failure(meGet("/api/v2/me/nope"));
    expect(err.message).toBe("Melhor Envio answered HTTP 404.");
  });
});
