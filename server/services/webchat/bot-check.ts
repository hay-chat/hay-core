/**
 * Reading the bot check a webchat conversation recorded at create time
 * (`conversation.metadata.botCheck`, written from the plugin gate outcome).
 *
 * A gate "flag" mixes two things: the visitor failed or skipped the challenge
 * (a bot signal), and the challenge could not run at all (Cloudflare or the
 * gate worker unreachable, our keys misconfigured). Only the first says
 * anything about the visitor.
 */

/** Gate reasons recorded when the server could not verify the visitor. */
const SERVER_UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([
  "provider_unavailable", // siteverify timed out, 5xx or internal-error
  "gate_unavailable", // the plugin worker did not answer (failure policy "open")
  "secret_missing",
  "secret_invalid",
]);

/**
 * Widget-reported errors (`challenge_error:<code>`) that mean the challenge
 * never loaded or ran in the shopper's browser: the provider script or frame
 * is unreachable, or the browser cannot run it. 200500 is Turnstile's "iframe
 * could not be loaded". Challenge failures (Turnstile 300xxx/600xxx, expired)
 * are not on the list: they are what a bot looks like.
 */
const CLIENT_UNAVAILABLE_ERRORS: ReadonlySet<string> = new Set([
  "unavailable",
  "timeout",
  "frame_failed",
  "render_failed",
  "unsupported",
  "network",
  "200500",
]);

interface BotCheckRecord {
  decision?: unknown;
  results?: Array<{ decision?: unknown; reason?: unknown }>;
}

/** True when a flagged result only says that verification was unavailable. */
export function isVerificationUnavailable(reason: unknown): boolean {
  if (typeof reason !== "string") return false;
  if (SERVER_UNAVAILABLE_REASONS.has(reason)) return true;
  const clientError = reason.startsWith("challenge_error:")
    ? reason.slice("challenge_error:".length)
    : null;
  return clientError !== null && CLIENT_UNAVAILABLE_ERRORS.has(clientError);
}

/**
 * True when the bot check flagged the visitor for something the visitor did
 * (failed or skipped the challenge), not because verification was unavailable.
 * A flag without per-plugin results counts as a bot signal.
 */
export function isBotFlagged(botCheck: unknown): boolean {
  const record = botCheck as BotCheckRecord | undefined | null;
  if (record?.decision !== "flag") return false;
  const flags = (record.results ?? []).filter((result) => result?.decision === "flag");
  if (flags.length === 0) return true;
  return flags.some((result) => !isVerificationUnavailable(result.reason));
}
