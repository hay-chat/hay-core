import crypto from "crypto";

/**
 * Timing-safe string comparison for signature verification.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time, then return false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify an HMAC-SHA256 signature over the exact raw request bytes.
 *
 * Computes `hex(hmacSha256(secret, rawBody))` and timing-safe compares it
 * against the provided header value. The header may carry a `sha256=` prefix
 * (Meta/GitHub style), which is stripped before comparison. Returns false for
 * any missing/malformed input rather than throwing. `encoding` "base64" reads
 * the header as base64 instead (Shopify).
 */
export function verifyHmacSha256(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  encoding: "hex" | "base64" = "hex",
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest(encoding);

  return timingSafeCompare(provided, expected);
}
