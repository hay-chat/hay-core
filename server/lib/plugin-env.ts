/**
 * Which host environment variables a plugin worker may receive.
 *
 * A plugin manifest lists the env vars it wants by name; anything that looks
 * like a secret or infrastructure setting is refused regardless. Pattern
 * matching keeps new secrets blocked by default without maintaining a list.
 */

const DENIED_ENV_PATTERNS = [
  /SECRET/i,
  /PASSWORD/i,
  /TOKEN/i,
  /PRIVATE.?KEY/i,
  /CREDENTIAL/i,
  /^DB_/i,
  /^DATABASE/i,
  /^REDIS/i,
  /^AWS_/i,
  /^OPENAI/i,
  /^ANTHROPIC/i,
  /^JWT/i,
  /^SMTP/i,
  /^GITHUB/i,
  /^NPM/i,
  /^PLUGIN_ENCRYPTION/i,
  /^HAY_/i, // Prevent plugins from overriding SDK internals
];

// Public identity values whose names match a denied pattern but hold no secret.
const PUBLIC_ENV_EXCEPTIONS = new Set(["SMTP_FROM_EMAIL", "SMTP_FROM_NAME"]);

/** Whether a host env var may never be handed to a plugin worker, whatever its manifest asks for. */
export function isDeniedPluginEnv(envVar: string): boolean {
  if (PUBLIC_ENV_EXCEPTIONS.has(envVar)) return false;
  return DENIED_ENV_PATTERNS.some((pattern) => pattern.test(envVar));
}
