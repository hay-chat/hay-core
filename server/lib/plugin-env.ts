/**
 * Which host environment variables a plugin may receive.
 *
 * A plugin's static manifest (package.json `hay-plugin.env`) lists the env vars
 * it wants by name; anything that looks like a secret or infrastructure setting
 * is refused regardless. Pattern matching keeps new secrets blocked by default
 * without maintaining a list.
 */

// Core's own infrastructure settings and secrets. No plugin may read these,
// core-shipped or not, whatever its manifest declares.
const CORE_RESERVED_ENV_PATTERNS = [
  /^DB_/i,
  /^DATABASE/i,
  /^REDIS/i,
  /^RABBITMQ/i,
  /^AWS_/i,
  /^OPENAI/i,
  /^LLM_/i,
  /^ANTHROPIC/i,
  /^JWT/i,
  /^SMTP/i,
  /^GITHUB/i,
  /^NPM/i,
  /^PLUGIN_ENCRYPTION/i,
  /^ENCRYPTION/i,
  /^INTERNAL_API/i,
  /^VAPID_PRIVATE/i,
  /^STRIPE_SECRET_KEY$/i,
  /^STRIPE_WEBHOOK_SECRET$/i,
  /^RESEND_EVENTS_WEBHOOK_SECRET$/i,
  /^HAY_/i, // Prevent plugins from overriding SDK internals
];

const SECRET_ENV_PATTERNS = [/SECRET/i, /PASSWORD/i, /TOKEN/i, /PRIVATE.?KEY/i, /CREDENTIAL/i];

// Public identity values whose names match a denied pattern but hold no secret.
const PUBLIC_ENV_EXCEPTIONS = new Set(["SMTP_FROM_EMAIL", "SMTP_FROM_NAME"]);

/** Whether a host env var belongs to core's own infrastructure. */
export function isCoreReservedEnv(envVar: string): boolean {
  if (PUBLIC_ENV_EXCEPTIONS.has(envVar)) return false;
  return CORE_RESERVED_ENV_PATTERNS.some((pattern) => pattern.test(envVar));
}

/** Whether a host env var may never be handed to a plugin worker, whatever its manifest asks for. */
export function isDeniedPluginEnv(envVar: string): boolean {
  if (PUBLIC_ENV_EXCEPTIONS.has(envVar)) return false;
  return isCoreReservedEnv(envVar) || SECRET_ENV_PATTERNS.some((pattern) => pattern.test(envVar));
}

/** The registry fields that decide which env vars a plugin's config may resolve. */
export interface PluginEnvSource {
  sourceType?: string;
  manifest?: { permissions?: { env?: string[] } } | null;
}

/**
 * Host env var names a plugin's config schema may resolve as server-managed
 * values (`configSchema[field].env`). The schema comes from the running worker,
 * so a name only counts when the plugin's static manifest also declares it.
 * Core-shipped plugins may resolve their own declared secrets (e.g. a managed
 * OAuth client secret); any other plugin gets the full deny-list.
 */
export function configEnvAllowList(plugin: PluginEnvSource | null | undefined): Set<string> {
  const declared = plugin?.manifest?.permissions?.env ?? [];
  const isDenied = plugin?.sourceType === "core" ? isCoreReservedEnv : isDeniedPluginEnv;
  return new Set(declared.filter((name) => typeof name === "string" && !isDenied(name)));
}
