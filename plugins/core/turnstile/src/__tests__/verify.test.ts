import { describe, it, expect, vi } from "vitest";
import { decide, normalizeMode, SITEVERIFY_URL } from "../verify.js";

const settings = { siteKey: "1x00000000000000000000AA", secretKey: "secret", mode: "invisible" as const };
const request = { frameHostname: "api.hay.chat", underAttack: false };

function siteverify(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("turnstile gate", () => {
  it("allows a token Cloudflare verifies for the frame hostname and action", async () => {
    const fetchMock = siteverify({ success: true, hostname: "api.hay.chat", action: "conversation_create" });
    await expect(decide(settings, { ...request, token: "t", ip: "1.2.3.4" }, fetchMock)).resolves.toEqual({
      decision: "allow",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(JSON.parse(String(init.body))).toEqual({ secret: "secret", response: "t", remoteip: "1.2.3.4" });
  });

  it("denies a token issued for another hostname or action", async () => {
    await expect(
      decide(settings, { ...request, token: "t" }, siteverify({ success: true, hostname: "evil.test", action: "conversation_create" })),
    ).resolves.toEqual({ decision: "deny", reason: "hostname_mismatch" });
    await expect(
      decide(settings, { ...request, token: "t" }, siteverify({ success: true, hostname: "api.hay.chat", action: "login" })),
    ).resolves.toEqual({ decision: "deny", reason: "action_mismatch" });
  });

  it("skips the binding checks for Cloudflare test keys", async () => {
    const fetchMock = siteverify({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } });
    await expect(decide(settings, { ...request, token: "t" }, fetchMock)).resolves.toMatchObject({ decision: "allow" });
  });

  it("denies a token Cloudflare rejects", async () => {
    const fetchMock = siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    await expect(decide(settings, { ...request, token: "t" }, fetchMock)).resolves.toEqual({
      decision: "deny",
      reason: "invalid_token",
    });
  });

  it("flags (never blocks) when Cloudflare is down or our secret is wrong", async () => {
    await expect(decide(settings, { ...request, token: "t" }, siteverify({}, 503))).resolves.toEqual({
      decision: "flag",
      reason: "provider_unavailable",
    });
    const throwing = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(decide(settings, { ...request, token: "t" }, throwing)).resolves.toMatchObject({ decision: "flag" });
    await expect(
      decide(settings, { ...request, token: "t" }, siteverify({ success: false, "error-codes": ["invalid-input-secret"] })),
    ).resolves.toEqual({ decision: "flag", reason: "secret_invalid" });
  });

  it("flags a widget-side challenge failure instead of blocking the shopper", async () => {
    const fetchMock = siteverify({});
    await expect(
      decide(settings, { ...request, contributionError: "timeout" }, fetchMock),
    ).resolves.toEqual({ decision: "flag", reason: "challenge_error:timeout" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies a missing token with a client-reported error when everyone must be challenged", async () => {
    const fetchMock = siteverify({});
    await expect(
      decide({ ...settings, mode: "challenge_all" }, { ...request, contributionError: "timeout" }, fetchMock),
    ).resolves.toEqual({ decision: "deny", reason: "token_missing" });
    await expect(
      decide(settings, { ...request, underAttack: true, contributionError: "timeout" }, fetchMock),
    ).resolves.toEqual({ decision: "deny", reason: "token_missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags a missing token in invisible mode and denies it when everyone must be challenged", async () => {
    await expect(decide(settings, request)).resolves.toEqual({ decision: "flag", reason: "token_missing" });
    await expect(decide({ ...settings, mode: "challenge_all" }, request)).resolves.toEqual({
      decision: "deny",
      reason: "token_missing",
    });
    await expect(decide({ ...settings, mode: "off" }, { ...request, underAttack: true })).resolves.toEqual({
      decision: "deny",
      reason: "token_missing",
    });
  });

  it("allows everything when the feature is off or unavailable", async () => {
    await expect(decide({ ...settings, mode: "off" }, request)).resolves.toEqual({ decision: "allow" });
    await expect(decide({ mode: "invisible" }, request)).resolves.toEqual({
      decision: "allow",
      reason: "not_configured",
    });
    await expect(decide({ siteKey: "k", mode: "invisible" }, request)).resolves.toEqual({
      decision: "flag",
      reason: "secret_missing",
    });
  });

  it("defaults unknown modes to invisible", () => {
    expect(normalizeMode(undefined)).toBe("invisible");
    expect(normalizeMode("challenge_all")).toBe("challenge_all");
  });
});
