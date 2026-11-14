/**
 * Token handling and error mapping against a mocked Correios API (no account).
 */
import { createRequire } from "node:module";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { makeEvent, makeSro, makeToken, POSTED } = require("./fixtures");
const { registerTrackingTools } = require("../tools/tracking");
const { fetchTracking, getToken, resetTokenCache, tokenRequest } = require("../lib/client");

const CODE = "AA123456789BR";
const CARD_PATH = "/token/v1/autentica/cartaopostagem";
const CONTRACT_PATH = "/token/v1/autentica/contrato";
const RASTRO_PATH = `/srorastro/v1/objetos/${CODE}`;
const ENV = [
  "CORREIOS_USERNAME",
  "CORREIOS_ACCESS_CODE",
  "CORREIOS_POSTING_CARD",
  "CORREIOS_CONTRACT",
];

const inMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const freshToken = (token = "tok-1") => makeToken({ token, expiraEm: inMinutes(24 * 60) });
const created = (body) => ({ status: 201, body });
const tracked = () => makeSro(CODE, [makeEvent(), POSTED]);

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

const realFetch = global.fetch;

beforeEach(() => {
  resetTokenCache();
  process.env.CORREIOS_USERNAME = "12345678000190";
  process.env.CORREIOS_ACCESS_CODE = "s3cret-code";
  process.env.CORREIOS_POSTING_CARD = "0012345678";
  delete process.env.CORREIOS_CONTRACT;
});

afterEach(() => {
  global.fetch = realFetch;
  for (const name of ENV) delete process.env[name];
});

describe("tokenRequest", () => {
  it("authorises by cartão de postagem when there is one, else by contract", () => {
    expect(tokenRequest({ postingCard: "0012345678", contract: "" })).toEqual({
      path: CARD_PATH,
      body: { numero: "0012345678" },
    });
    expect(tokenRequest({ postingCard: "0012345678", contract: "9912345678" })).toEqual({
      path: CARD_PATH,
      body: { numero: "0012345678", contrato: "9912345678" },
    });
    expect(tokenRequest({ postingCard: "", contract: "9912345678" })).toEqual({
      path: CONTRACT_PATH,
      body: { numero: "9912345678" },
    });
  });
});

describe("token", () => {
  it("sends Basic auth + the posting card, and reuses the token until it expires", async () => {
    const { calls } = mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(freshToken()) },
      { path: RASTRO_PATH, reply: tracked },
    ]);
    await fetchTracking(CODE);
    await fetchTracking(CODE);

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST ${CARD_PATH}`,
      `GET ${RASTRO_PATH}`,
      `GET ${RASTRO_PATH}`,
    ]);
    expect(calls[0].init.headers.Authorization).toBe(
      `Basic ${Buffer.from("12345678000190:s3cret-code").toString("base64")}`,
    );
    expect(calls[0].body).toEqual({ numero: "0012345678" });
    expect(calls[1].init.headers.Authorization).toBe("Bearer tok-1");
    expect(calls[1].query.get("resultado")).toBe("T");
  });

  it("authorises by contract when no posting card is configured", async () => {
    delete process.env.CORREIOS_POSTING_CARD;
    process.env.CORREIOS_CONTRACT = "9912345678";
    const { calls } = mockFetch([
      { method: "POST", path: CONTRACT_PATH, reply: () => created(freshToken()) },
    ]);
    expect(await getToken()).toBe("tok-1");
    expect(calls[0].body).toEqual({ numero: "9912345678" });
  });

  it("asks for a new token shortly before the cached one expires", async () => {
    const tokens = [
      makeToken({ token: "old", expiraEm: inMinutes(2) }),
      makeToken({ token: "new", expiraEm: inMinutes(24 * 60) }),
    ];
    const { calls } = mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(tokens.shift()) },
    ]);
    expect(await getToken()).toBe("old");
    expect(await getToken()).toBe("new");
    expect(await getToken()).toBe("new");
    expect(calls).toHaveLength(2);
  });

  it("does not reuse a token whose expiry it cannot read", async () => {
    const { calls } = mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(makeToken({ expiraEm: undefined })) },
    ]);
    await getToken();
    await getToken();
    expect(calls).toHaveLength(2);
  });

  it("shares one token request between concurrent calls", async () => {
    const { calls } = mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(freshToken()) },
    ]);
    expect(await Promise.all([getToken(), getToken(), getToken()])).toEqual([
      "tok-1",
      "tok-1",
      "tok-1",
    ]);
    expect(calls).toHaveLength(1);
  });

  it("maps a wrong user or access code (401, empty body) to AUTH_FAILED", async () => {
    mockFetch([{ method: "POST", path: CARD_PATH, reply: () => ({ status: 401, body: null }) }]);
    const err = await rejection(fetchTracking(CODE));
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("user or API access code");
    expect(err.message).not.toContain("s3cret-code");
  });

  it("maps a refused posting card (400 + msgs) to AUTH_FAILED with what Correios said", async () => {
    mockFetch([
      {
        method: "POST",
        path: CARD_PATH,
        reply: () => ({ status: 400, body: { msgs: ["Cartão de postagem inválido."] } }),
      },
    ]);
    const err = await rejection(fetchTracking(CODE));
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.message).toContain("Cartão de postagem inválido.");
  });

  it("fails as INTERNAL when the connection is not configured", async () => {
    delete process.env.CORREIOS_POSTING_CARD;
    const { calls } = mockFetch([]);
    expect((await rejection(getToken())).code).toBe("INTERNAL");
    expect(calls).toHaveLength(0);
  });
});

describe("tracking request", () => {
  it("drops a rejected token and repeats the call once with a new one", async () => {
    const tokens = [freshToken("stale"), freshToken("fresh")];
    const { calls } = mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(tokens.shift()) },
      {
        path: RASTRO_PATH,
        reply: (ctx) =>
          ctx.init.headers.Authorization === "Bearer fresh"
            ? tracked()
            : { status: 403, body: { msgs: ["GTW-006: Token inválido."] } },
      },
    ]);
    const sro = await fetchTracking(CODE);
    expect(sro.objetos[0].codObjeto).toBe(CODE);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "POST", "GET"]);
  });

  it("maps a contract without access to API Rastro (403 twice) to SCOPE_MISSING", async () => {
    const { calls } = mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(freshToken()) },
      {
        path: RASTRO_PATH,
        reply: () => ({ status: 403, body: { msgs: ["GTW-007: Acesso negado."] } }),
      },
    ]);
    const err = await rejection(fetchTracking(CODE));
    expect(err.code).toBe("SCOPE_MISSING");
    expect(err.message).toContain("API Rastro");
    expect(err.details.correiosMessage).toBe("GTW-007: Acesso negado.");
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("retries a 5xx once, then reports PROVIDER_DOWN (retryable)", async () => {
    const { calls } = mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(freshToken()) },
      { path: RASTRO_PATH, reply: () => ({ status: 503, body: { msgs: ["indisponível"] } }) },
    ]);
    const err = await rejection(fetchTracking(CODE));
    expect(err.code).toBe("PROVIDER_DOWN");
    expect(err.retryable).toBe(true);
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("recovers when the retry after a 5xx succeeds", async () => {
    let first = true;
    mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(freshToken()) },
      {
        path: RASTRO_PATH,
        reply: () => {
          if (!first) return tracked();
          first = false;
          return { status: 500, body: null };
        },
      },
    ]);
    expect((await fetchTracking(CODE)).objetos).toHaveLength(1);
  });

  it("maps 429 to RATE_LIMITED and a network failure to PROVIDER_DOWN", async () => {
    mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(freshToken()) },
      { path: RASTRO_PATH, reply: () => ({ status: 429, body: null }) },
    ]);
    expect((await rejection(fetchTracking(CODE))).code).toBe("RATE_LIMITED");

    resetTokenCache();
    global.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const err = await rejection(fetchTracking(CODE));
    expect(err.code).toBe("PROVIDER_DOWN");
    expect(err.message).toContain("did not respond");
  });

  it("returns null for a 404 so the tool can explain it", async () => {
    mockFetch([{ method: "POST", path: CARD_PATH, reply: () => created(freshToken()) }]);
    expect(await fetchTracking(CODE)).toBeNull();
  });
});

describe("correios_track_shipment", () => {
  const server = createFakeServer();
  registerTrackingTools(server);

  it("normalises the code, fetches a token then the events, and returns the summary", async () => {
    const { calls } = mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(freshToken()) },
      { path: RASTRO_PATH, reply: tracked },
    ]);
    const res = await server.call("correios_track_shipment", { tracking_code: "aa 123456789 br" });
    expect(res.isError).toBe(false);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST ${CARD_PATH}`,
      `GET ${RASTRO_PATH}`,
    ]);
    expect(res.data).toMatchObject({
      trackingCode: CODE,
      status: "in_transit",
      delivered: false,
      eventCount: 2,
    });
    expect(res.data.summary).toContain(CODE);
    expect(typeof res.data.tracking.isStale).toBe("boolean");
  });

  it("refuses a malformed code without calling Correios", async () => {
    const { calls } = mockFetch([]);
    const res = await server.call("correios_track_shipment", { tracking_code: "12345" });
    expect(res.error.code).toBe("BAD_INPUT");
    expect(calls).toHaveLength(0);
  });

  it("answers NOT_FOUND with the own-contract explanation for an unknown object", async () => {
    mockFetch([
      { method: "POST", path: CARD_PATH, reply: () => created(freshToken()) },
      {
        path: RASTRO_PATH,
        reply: () => makeSro(CODE, undefined, { mensagem: "SRO-020: Objeto não encontrado" }),
      },
    ]);
    const res = await server.call("correios_track_shipment", { tracking_code: CODE });
    expect(res.error.code).toBe("NOT_FOUND");
    expect(res.error.message).toContain("own Correios contract");
    expect(res.error.details.correiosMessage).toBe("SRO-020: Objeto não encontrado");
  });
});
