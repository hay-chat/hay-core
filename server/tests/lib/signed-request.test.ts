import crypto from "crypto";
import { describe, it, expect } from "@jest/globals";
import { parseSignedRequest } from "../../lib/signed-request";

const SECRET = "test-app-secret";

function sign(payload: unknown, secret = SECRET): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${signature}.${encodedPayload}`;
}

describe("parseSignedRequest", () => {
  const payload = { algorithm: "HMAC-SHA256", issued_at: 1727500000, user_id: "17841400000000000" };

  it("returns the decoded payload for a valid signature", () => {
    expect(parseSignedRequest(sign(payload), SECRET)).toEqual(payload);
  });

  it("rejects a request signed with a different secret", () => {
    expect(parseSignedRequest(sign(payload, "other-secret"), SECRET)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [signature] = sign(payload).split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, user_id: "1" })).toString("base64url");
    expect(parseSignedRequest(`${signature}.${forged}`, SECRET)).toBeNull();
  });

  it("rejects a non-HMAC-SHA256 algorithm", () => {
    expect(parseSignedRequest(sign({ ...payload, algorithm: "none" }), SECRET)).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["non-string", 42],
    ["empty", ""],
    ["no separator", "abc"],
    ["too many segments", "a.b.c"],
    ["empty payload segment", "abc."],
  ])("rejects a malformed value (%s)", (_label, value) => {
    expect(parseSignedRequest(value, SECRET)).toBeNull();
  });

  it("rejects a correctly signed payload that is not a JSON object", () => {
    const encodedPayload = Buffer.from("not json").toString("base64url");
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(encodedPayload)
      .digest("base64url");
    expect(parseSignedRequest(`${signature}.${encodedPayload}`, SECRET)).toBeNull();
    expect(parseSignedRequest(sign([1, 2]), SECRET)).toBeNull();
  });

  it("rejects when no secret is configured", () => {
    expect(parseSignedRequest(sign(payload), "")).toBeNull();
  });
});
