import { describe, expect, it, vi } from "vitest";
import {
  SESSION_TTL_MS,
  WcAuthSessions,
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
    const sessions = new WcAuthSessions();
    const nonce = sessions.start(SITE);
    const fetchImpl = okFetch();

    expect(sessions.status(nonce)).toEqual({ state: "pending" });
    await sessions.receive({ ...KEYS, user_id: nonce }, fetchImpl);

    const call = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(call).toContain(`${SITE}/wp-json/wc/v3/system_status`);
    expect(call).toContain("consumer_key=ck_abc123");

    expect(sessions.status(nonce)).toEqual({
      state: "connected",
      consumerKey: "ck_abc123",
      consumerSecret: "cs_def456",
      keyPermissions: "read_write",
    });
    expect(sessions.status(nonce)).toEqual({ state: "unknown" });
  });

  it("rejects a callback with an unknown nonce without calling the store", async () => {
    const sessions = new WcAuthSessions();
    const fetchImpl = okFetch();
    await expect(sessions.receive({ ...KEYS, user_id: "forged" }, fetchImpl)).rejects.toMatchObject(
      { code: "UNKNOWN_SESSION" },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not accept a second callback for the same nonce", async () => {
    const sessions = new WcAuthSessions();
    const nonce = sessions.start(SITE);
    await sessions.receive({ ...KEYS, user_id: nonce }, okFetch());
    await expect(
      sessions.receive({ ...KEYS, consumer_key: "ck_other", user_id: nonce }, okFetch()),
    ).rejects.toMatchObject({ code: "UNKNOWN_SESSION" });
  });

  it("records read-only keys as an error", async () => {
    const sessions = new WcAuthSessions();
    const nonce = sessions.start(SITE);
    await expect(
      sessions.receive({ ...KEYS, key_permissions: "read", user_id: nonce }, okFetch()),
    ).rejects.toMatchObject({ code: "WRONG_PERMISSIONS" });
    expect(sessions.status(nonce)).toMatchObject({ state: "error", code: "WRONG_PERMISSIONS" });
  });

  it("records keys the store rejects as an error", async () => {
    const sessions = new WcAuthSessions();
    const nonce = sessions.start(SITE);
    await expect(sessions.receive({ ...KEYS, user_id: nonce }, okFetch(401))).rejects.toMatchObject(
      { code: "KEYS_REJECTED" },
    );
    expect(sessions.status(nonce)).toMatchObject({ state: "error", code: "KEYS_REJECTED" });
  });

  it("expires pending sessions", async () => {
    let now = 1_000;
    const sessions = new WcAuthSessions(() => now);
    const nonce = sessions.start(SITE);
    now += SESSION_TTL_MS + 1;
    expect(sessions.status(nonce)).toEqual({ state: "unknown" });
    await expect(sessions.receive({ ...KEYS, user_id: nonce }, okFetch())).rejects.toMatchObject({
      code: "UNKNOWN_SESSION",
    });
  });
});
