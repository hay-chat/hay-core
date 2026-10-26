import crypto from "crypto";

/** Clock skew a Standard Webhooks timestamp may have before it is rejected. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Verify a Standard Webhooks / Svix signature (used by Resend among others).
 *
 * The provider signs `${svix-id}.${svix-timestamp}.${rawBody}` with the
 * base64-decoded secret (the `whsec_` prefix is not part of the key) and sends
 * one or more space-separated `v1,<base64 signature>` entries in
 * `svix-signature`. Any matching entry accepts the request; a timestamp more
 * than five minutes from now rejects it.
 */
export function verifySvixSignature(
  rawBody: Buffer,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  now: Date = new Date(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds)) {
    return false;
  }
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestampSeconds) > TOLERANCE_SECONDS) {
    return false;
  }

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  if (key.length === 0) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(rawBody)
    .digest();

  return signature
    .split(" ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("v1,"))
    .some((entry) => {
      const provided = Buffer.from(entry.slice("v1,".length), "base64");
      return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    });
}

/**
 * Normalise an email routing key: `"Name" <User+tag@Host>` → `user@host`.
 * Returns undefined when the value holds no address.
 */
export function normalizeEmailAddressKey(value: string): string | undefined {
  const angle = value.match(/<([^<>]+)>/);
  const candidate = (angle ? angle[1] : value).trim().toLowerCase();
  const at = candidate.lastIndexOf("@");
  if (at <= 0 || at === candidate.length - 1 || /\s/.test(candidate)) {
    return undefined;
  }
  const local = candidate.slice(0, at).split("+")[0];
  const domain = candidate.slice(at + 1);
  return local ? `${local}@${domain}` : undefined;
}
