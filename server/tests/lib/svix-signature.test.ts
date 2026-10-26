import crypto from "crypto";
import { normalizeEmailAddressKey, verifySvixSignature } from "@server/lib/svix-signature";

const secretBytes = crypto.randomBytes(24);
const secret = `whsec_${secretBytes.toString("base64")}`;
const now = new Date("2026-10-26T12:00:00Z");
const timestamp = String(Math.floor(now.getTime() / 1000));
const body = Buffer.from('{"type":"email.received","data":{"email_id":"e1"}}');

function sign(id: string, ts: string, payload: Buffer, key: Buffer = secretBytes): string {
  return crypto.createHmac("sha256", key).update(`${id}.${ts}.`).update(payload).digest("base64");
}

describe("verifySvixSignature", () => {
  it("accepts a valid v1 signature", () => {
    const signature = `v1,${sign("msg_1", timestamp, body)}`;
    expect(
      verifySvixSignature(body, { id: "msg_1", timestamp, signature }, secret, now),
    ).toBe(true);
  });

  it("accepts when any of several space-separated signatures matches", () => {
    const signature = `v1,${sign("msg_1", timestamp, body, crypto.randomBytes(24))} v1,${sign("msg_1", timestamp, body)}`;
    expect(
      verifySvixSignature(body, { id: "msg_1", timestamp, signature }, secret, now),
    ).toBe(true);
  });

  it("rejects a tampered body, a wrong id and a wrong secret", () => {
    const signature = `v1,${sign("msg_1", timestamp, body)}`;
    expect(
      verifySvixSignature(Buffer.from("{}"), { id: "msg_1", timestamp, signature }, secret, now),
    ).toBe(false);
    expect(
      verifySvixSignature(body, { id: "msg_2", timestamp, signature }, secret, now),
    ).toBe(false);
    expect(
      verifySvixSignature(
        body,
        { id: "msg_1", timestamp, signature },
        `whsec_${crypto.randomBytes(24).toString("base64")}`,
        now,
      ),
    ).toBe(false);
  });

  it("rejects a timestamp outside the five-minute tolerance", () => {
    const stale = String(Number(timestamp) - 6 * 60);
    const signature = `v1,${sign("msg_1", stale, body)}`;
    expect(
      verifySvixSignature(body, { id: "msg_1", timestamp: stale, signature }, secret, now),
    ).toBe(false);
  });

  it("rejects missing headers and non-v1 entries", () => {
    expect(verifySvixSignature(body, { timestamp, signature: "v1,abc" }, secret, now)).toBe(false);
    expect(
      verifySvixSignature(
        body,
        { id: "msg_1", timestamp, signature: `v0,${sign("msg_1", timestamp, body)}` },
        secret,
        now,
      ),
    ).toBe(false);
  });
});

describe("normalizeEmailAddressKey", () => {
  it("extracts, lowercases and strips sub-addresses", () => {
    expect(normalizeEmailAddressKey('"Acme" <Support+c42@Acme.com>')).toBe("support@acme.com");
    expect(normalizeEmailAddressKey("in-3f9a2b@inbound.hay.chat")).toBe("in-3f9a2b@inbound.hay.chat");
    expect(normalizeEmailAddressKey("  USER@Example.ORG ")).toBe("user@example.org");
  });

  it("returns undefined for values that are not addresses", () => {
    expect(normalizeEmailAddressKey("not an address")).toBeUndefined();
    expect(normalizeEmailAddressKey("@nolocal.com")).toBeUndefined();
    expect(normalizeEmailAddressKey("nodomain@")).toBeUndefined();
    expect(normalizeEmailAddressKey("+tagonly@host.com")).toBeUndefined();
  });
});
