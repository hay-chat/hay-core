import { describe, expect, it, vi } from "vitest";
import {
  SESSION_TTL_MS,
  WcAuthSessions,
  type WcAuthStore,
  buildAuthorizeUrl,
  buildCallbackUrl,
  normalizeSiteUrl,
  safeReturnUrl,
} from "./wc-auth";

const SITE = "https://shop.example.com";
const KEYS = {
  consumer_key: "ck_abc123",
  consumer_secret: "cs_def456",
  key_permissions: "read_write",
};

/** In-memory stand-in for core's plugin state store, with a controllable clock for TTLs. */
function memoryStore(clock: { now: number } = { now: 0 }) {
  const rows = new Map<string, { json: string; expiresAt: number | null }>();
  const store: WcAuthStore = {
    async get<T>(key: string) {
      const row = rows.get(key);
      if (!row || (row.expiresAt !== null && row.expiresAt <= clock.now)) return null;
      return JSON.parse(row.json) as T;
    },
    async set(key, value, options) {
      const ttl = options?.ttlMs;
      rows.set(key, { json: JSON.stringify(value), expiresAt: ttl ? clock.now + ttl : null });
    },
    async delete(key) {
      rows.delete(key);
    },
  };
  return { store, rows, clock };
}

function okFetch(status = 200) {
  return vi.fn(async () => new Response("{}", { status })) as unknown as typeof fetch;
}

describe("wc-auth URLs", () => {
  it("builds the authorize URL with a nonce as user_id and Hay.chat as app name", () => {
    const url = new URL(
      buildAuthorizeUrl({
        siteUrl: SITE,
        nonce: "n1",
        callbackUrl: "https://api.hay.chat/cb",
        returnUrl: "https://app.hay.chat/back",
      }),
    );
    expect(url.origin + url.pathname).toBe(`${SITE}/wc-auth/v1/authorize`);
    expect(url.searchParams.get("app_name")).toBe("Hay.chat");
    expect(url.searchParams.get("scope")).toBe("read_write");
    expect(url.searchParams.get("user_id")).toBe("n1");
    expect(url.searchParams.get("callback_url")).toBe("https://api.hay.chat/cb");
  });

  it("routes the callback through the plugin proxy with the org id", () => {
    expect(buildCallbackUrl("https://api.hay.chat/", "hay-plugin-woocommerce", "org-1")).toBe(
      "https://api.hay.chat/v1/plugins/hay-plugin-woocommerce/wc-auth/callback?organizationId=org-1",
    );
  });

  it("refuses a non-HTTPS callback (WooCommerce requires it)", () => {
    expect(() => buildCallbackUrl("http://localhost:3001", "p", "o")).toThrow(
      expect.objectContaining({ code: "HTTPS_REQUIRED" }),
    );
  });

  it("normalizes the site URL and requires one", () => {
    expect(normalizeSiteUrl(" https://shop.example.com/store/ ")).toBe(
      "https://shop.example.com/store",
    );
    expect(() => normalizeSiteUrl(undefined)).toThrow(
      expect.objectContaining({ code: "SITE_URL_MISSING" }),
    );
    expect(() => normalizeSiteUrl("ftp://x")).toThrow(
      expect.objectContaining({ code: "SITE_URL_INVALID" }),
    );
  });

  it("only returns to an HTTPS (or localhost) URL", () => {
    expect(safeReturnUrl("https://app.hay.chat/x", SITE)).toBe("https://app.hay.chat/x");
    expect(safeReturnUrl("javascript:alert(1)", SITE)).toBe(SITE);
    expect(safeReturnUrl(undefined, SITE)).toBe(SITE);
  });
});

describe("WcAuthSessions", () => {
  it("accepts keys for a pending nonce, verifies them, and hands them out once", async () => {
    const sessions = new WcAuthSessions(memoryStore().store);
    const nonce = await sessions.start(SITE);
    const fetchImpl = okFetch();

    expect(await sessions.status(nonce)).toEqual({ state: "pending" });
    await sessions.receive({ ...KEYS, user_id: nonce }, fetchImpl);

    const call = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(call).toContain(`${SITE}/wp-json/wc/v3/system_status`);
    expect(call).toContain("consumer_key=ck_abc123");

    expect(await sessions.status(nonce)).toEqual({
      state: "connected",
      consumerKey: "ck_abc123",
      consumerSecret: "cs_def456",
      keyPermissions: "read_write",
    });
    expect(await sessions.status(nonce)).toEqual({ state: "unknown" });
  });

  it("rejects a callback with an unknown nonce without calling the store", async () => {
    const sessions = new WcAuthSessions(memoryStore().store);
    const fetchImpl = okFetch();
    await expect(sessions.receive({ ...KEYS, user_id: "forged" }, fetchImpl)).rejects.toMatchObject(
      { code: "UNKNOWN_SESSION" },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not accept a second callback for the same nonce", async () => {
    const sessions = new WcAuthSessions(memoryStore().store);
    const nonce = await sessions.start(SITE);
    await sessions.receive({ ...KEYS, user_id: nonce }, okFetch());
    await expect(
      sessions.receive({ ...KEYS, consumer_key: "ck_other", user_id: nonce }, okFetch()),
    ).rejects.toMatchObject({ code: "UNKNOWN_SESSION" });
  });

  it("records read-only keys as an error", async () => {
    const sessions = new WcAuthSessions(memoryStore().store);
    const nonce = await sessions.start(SITE);
    await expect(
      sessions.receive({ ...KEYS, key_permissions: "read", user_id: nonce }, okFetch()),
    ).rejects.toMatchObject({ code: "WRONG_PERMISSIONS" });
    expect(await sessions.status(nonce)).toMatchObject({ state: "error", code: "WRONG_PERMISSIONS" });
  });

  it("records keys the store rejects as an error", async () => {
    const sessions = new WcAuthSessions(memoryStore().store);
    const nonce = await sessions.start(SITE);
    await expect(sessions.receive({ ...KEYS, user_id: nonce }, okFetch(401))).rejects.toMatchObject(
      { code: "KEYS_REJECTED" },
    );
    expect(await sessions.status(nonce)).toMatchObject({ state: "error", code: "KEYS_REJECTED" });
  });

  it("expires pending sessions", async () => {
    const clock = { now: 1_000 };
    const sessions = new WcAuthSessions(memoryStore(clock).store);
    const nonce = await sessions.start(SITE);
    clock.now += SESSION_TTL_MS + 1;
    expect(await sessions.status(nonce)).toEqual({ state: "unknown" });
    await expect(sessions.receive({ ...KEYS, user_id: nonce }, okFetch())).rejects.toMatchObject({
      code: "UNKNOWN_SESSION",
    });
  });

  it("survives a restart: a new instance over the same store finishes the connect", async () => {
    const { store, rows } = memoryStore();
    const nonce = await new WcAuthSessions(store).start(SITE);
    expect([...rows.keys()]).toEqual([`wc-auth:${nonce}`]);

    const afterRestart = new WcAuthSessions(store);
    await afterRestart.receive({ ...KEYS, user_id: nonce }, okFetch());
    expect(await new WcAuthSessions(store).status(nonce)).toMatchObject({ state: "connected" });
    expect(rows.size).toBe(0);
  });

  it("ignores malformed nonces without touching the store", async () => {
    const store = memoryStore().store;
    const get = vi.spyOn(store, "get");
    const sessions = new WcAuthSessions(store);
    expect(await sessions.status("../../etc")).toEqual({ state: "unknown" });
    expect(await sessions.status(42)).toEqual({ state: "unknown" });
    expect(get).not.toHaveBeenCalled();
  });
});
