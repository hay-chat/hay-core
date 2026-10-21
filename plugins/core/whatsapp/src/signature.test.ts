import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { isTrustedWebhook, isValidMetaSignature, verificationChallenge } from "./signature.js";
import type { WhatsAppConnection } from "./connection.js";

const manual: WhatsAppConnection = {
  mode: "manual",
  accessToken: "t",
  phoneNumberId: "1",
  wabaId: "2",
  appSecret: "app-secret",
  verifyToken: "verify-me",
};
const embedded: WhatsAppConnection = { mode: "embedded-signup", accessToken: "t", phoneNumberId: "1", wabaId: "2" };

const body = '{"object":"whatsapp_business_account","entry":[]}';
const sign = (raw: string, secret: string) =>
  `sha256=${crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;

describe("isValidMetaSignature", () => {
  it("accepts the HMAC of the raw bytes", () => {
    expect(isValidMetaSignature(body, sign(body, "app-secret"), "app-secret")).toBe(true);
  });

  it("rejects another secret, a tampered body, a missing prefix or header", () => {
    expect(isValidMetaSignature(body, sign(body, "other"), "app-secret")).toBe(false);
    expect(isValidMetaSignature(`${body} `, sign(body, "app-secret"), "app-secret")).toBe(false);
    expect(isValidMetaSignature(body, sign(body, "app-secret").slice(7), "app-secret")).toBe(false);
    expect(isValidMetaSignature(body, undefined, "app-secret")).toBe(false);
    expect(isValidMetaSignature(undefined, sign(body, "app-secret"), "app-secret")).toBe(false);
  });
});

describe("isTrustedWebhook", () => {
  it("trusts payloads core verified on the shared URL", () => {
    expect(isTrustedWebhook({ headers: { "x-hay-webhook-verified": "true" } }, embedded)).toBe(true);
  });

  it("verifies manual-mode signatures with the org's app secret", () => {
    const headers = { "x-hub-signature-256": sign(body, "app-secret") };
    expect(isTrustedWebhook({ headers, rawBody: body }, manual)).toBe(true);
    expect(isTrustedWebhook({ headers, rawBody: body }, embedded)).toBe(false);
    expect(isTrustedWebhook({ headers, rawBody: body }, null)).toBe(false);
  });

  it("rejects an unsigned direct hit", () => {
    expect(isTrustedWebhook({ headers: {}, rawBody: body }, manual)).toBe(false);
  });
});

describe("verificationChallenge", () => {
  const query = { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444" };

  it("echoes the challenge for the manual verify token", () => {
    expect(verificationChallenge(query, manual)).toBe("1158201444");
  });

  it("refuses a wrong token, wrong mode or non-manual connection", () => {
    expect(verificationChallenge({ ...query, "hub.verify_token": "nope" }, manual)).toBeNull();
    expect(verificationChallenge({ ...query, "hub.mode": "unsubscribe" }, manual)).toBeNull();
    expect(verificationChallenge(query, embedded)).toBeNull();
    expect(verificationChallenge(query, null)).toBeNull();
  });
});
