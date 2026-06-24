/**
 * Hay Plugin SDK - Webhook Routing Types
 *
 * Types for a plugin-declared, fully generic webhook routing strategy.
 *
 * Some providers (e.g. shared-app channel integrations) deliver every org's
 * events to a SINGLE shared webhook URL that carries no org identifier. The
 * plugin DECLARES — as plain data — how Hay Core should:
 *
 *   1. verify the request signature,
 *   2. answer a verification handshake (GET challenge),
 *   3. extract per-event routing keys from the payload,
 *
 * and Core executes that strategy blindly to fan the single webhook out to the
 * right per-org workers. Core never learns which provider this is; all
 * provider-specific knowledge stays in the declaration.
 *
 * @module @hay/plugin-sdk/types/webhook-routing
 */

/**
 * Signature verification descriptor.
 *
 * Core verifies an HMAC-SHA256 over the EXACT raw request bytes using the
 * secret read from `process.env[secretEnv]`, then timing-safe compares the
 * lowercase hex digest against the value in the named header (the header value
 * may carry a `sha256=` prefix, which Core strips before comparing).
 */
export interface WebhookSignatureDescriptor {
  /** Request header carrying the signature (e.g. "x-hub-signature-256"). */
  header: string;

  /** Signature format. Only HMAC-SHA256 is supported today. */
  format: "sha256-hmac";

  /**
   * Name of the environment variable holding the shared signing secret.
   * Must be present in the plugin manifest `env` allowlist.
   */
  secretEnv: string;
}

/**
 * Verification-challenge (GET handshake) descriptor.
 *
 * On a GET to the webhook URL, Core echoes the `challengeParam` query value
 * when `modeParam` equals "subscribe" and the supplied verify token matches the
 * plugin's configured/declared verify token.
 */
export interface WebhookVerificationChallengeDescriptor {
  /** Query param naming the handshake mode (e.g. "hub.mode"). */
  modeParam: string;

  /** Query param carrying the caller's verify token (e.g. "hub.verify_token"). */
  verifyTokenParam: string;

  /** Query param carrying the challenge to echo back (e.g. "hub.challenge"). */
  challengeParam: string;

  /**
   * Config field name on the plugin instance holding the expected verify token.
   * For a shared-app model this is typically a single shared token, so prefer
   * `verifyTokenEnv`; this field exists for per-instance tokens.
   */
  verifyTokenConfigField?: string;

  /**
   * Environment variable holding the expected verify token. Used by the
   * shared-app model where one token guards the single shared URL. Must be in
   * the plugin manifest `env` allowlist.
   */
  verifyTokenEnv?: string;
}

/**
 * Route-key extraction descriptor.
 *
 * A MINIMAL, no-eval extractor: `itemsPath` is a dot-path to an array on the
 * parsed JSON body (e.g. "entry"); `keyPath` is a dot-path to the routing key
 * on each array item (e.g. "id"). No code execution, no DSL.
 */
export interface WebhookRouteKeyPathDescriptor {
  /** Dot-path to the array of events on the parsed body (e.g. "entry"). */
  itemsPath: string;

  /** Dot-path to the routing key on each event item (e.g. "id"). */
  keyPath: string;
}

/**
 * Full webhook routing strategy a plugin declares via `register.webhookRouting`.
 */
export interface WebhookRoutingDescriptor {
  signature: WebhookSignatureDescriptor;
  verificationChallenge?: WebhookVerificationChallengeDescriptor;
  routeKeyPath: WebhookRouteKeyPathDescriptor;
}
