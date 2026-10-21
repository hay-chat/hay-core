import crypto from "node:crypto";
import type { WhatsAppConnection } from "./connection.js";

/**
 * Webhook trust for the two connection modes.
 *
 * Embedded Signup: Meta signs with Hay's app secret, which only core holds.
 * Core verifies the shared webhook, then forwards each org's slice with
 * `x-hay-webhook-verified: true` (the public proxy strips that header from
 * outside requests, so only core can set it).
 *
 * Manual: the org's own Meta app posts to the per-org URL. The worker checks
 * `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the org's app
 * secret) and answers the GET handshake with the org's verify token.
 */

function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Whether `header` (`sha256=<hex>`) is the HMAC-SHA256 of `rawBody` under `appSecret`. */
export function isValidMetaSignature(
  rawBody: string | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !header || !header.startsWith("sha256=")) {
    return false;
  }
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqualStrings(header.slice("sha256=".length), expected);
}

export interface WebhookRequestLike {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: string;
}

/** Whether an inbound POST may be processed. */
export function isTrustedWebhook(
  req: WebhookRequestLike,
  connection: WhatsAppConnection | null,
): boolean {
  if (req.headers["x-hay-webhook-verified"] === "true") {
    return true;
  }
  if (connection?.mode !== "manual" || !connection.appSecret) {
    return false;
  }
  const header = req.headers["x-hub-signature-256"];
  return isValidMetaSignature(
    req.rawBody,
    typeof header === "string" ? header : undefined,
    connection.appSecret,
  );
}

/**
 * Answer Meta's GET verification handshake for manual mode. Returns the
 * challenge to echo, or null when the request must be refused.
 */
export function verificationChallenge(
  query: Record<string, unknown>,
  connection: WhatsAppConnection | null,
): string | null {
  const verifyToken = connection?.mode === "manual" ? connection.verifyToken : undefined;
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (
    !verifyToken ||
    mode !== "subscribe" ||
    typeof token !== "string" ||
    typeof challenge !== "string" ||
    !timingSafeEqualStrings(token, verifyToken)
  ) {
    return null;
  }
  return challenge;
}
