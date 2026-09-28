import crypto from "crypto";

/**
 * Parse and verify a provider "signed request":
 * `<base64url HMAC-SHA256 signature>.<base64url JSON payload>`, where the
 * signature is computed over the encoded payload segment with the app secret.
 *
 * @returns The decoded payload object, or null when the value is malformed,
 *   the signature does not match, or the payload is not a JSON object.
 */
export function parseSignedRequest(
  signedRequest: unknown,
  secret: string,
): Record<string, unknown> | null {
  if (typeof signedRequest !== "string" || !secret) {
    return null;
  }

  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  const [encodedSignature, encodedPayload] = parts;

  const provided = Buffer.from(encodedSignature, "base64url");
  const expected = crypto.createHmac("sha256", secret).update(encodedPayload).digest();
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return null;
    }
    const { algorithm } = payload as { algorithm?: unknown };
    if (algorithm !== undefined && String(algorithm).toUpperCase() !== "HMAC-SHA256") {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}
