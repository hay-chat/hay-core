/**
 * How a Melhor Envio account is connected, and where its token comes from.
 *
 * - `oauth` (Hay.chat's Melhor Envio app): the merchant clicks Connect. Core runs
 *   the OAuth flow, stores the tokens, refreshes them (access tokens last 30
 *   days, refresh tokens 45) and merges `accessToken` into the config.
 * - `token`: the merchant pastes a token generated in their Melhor Envio panel.
 *   Kept for servers without MELHOR_ENVIO_OAUTH_CLIENT_ID.
 */

export type AuthMode = "oauth" | "token";

interface ConfigReader {
  getOptional: <T = unknown>(key: string) => T | undefined;
}

/** Default when the merchant has not picked a mode: OAuth when this server has the app. */
export function defaultAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  return env.MELHOR_ENVIO_OAUTH_CLIENT_ID?.trim() ? "oauth" : "token";
}

export function getAuthMode(config: ConfigReader, env: NodeJS.ProcessEnv = process.env): AuthMode {
  const mode = config.getOptional<string>("authMode");
  if (mode === "oauth" || mode === "token") return mode;
  return defaultAuthMode(env);
}

/** The access token, without the "Bearer " prefix people sometimes copy with it. */
export function readAccessToken(config: ConfigReader): string {
  const value = config.getOptional<unknown>("accessToken");
  return typeof value === "string" ? value.trim().replace(/^Bearer\s+/i, "") : "";
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@()]+@[^\s@()]+\.[^\s@()]+$/.test(value.trim());
}

/**
 * Melhor Envio requires a User-Agent naming the application and a technical
 * contact on every request, e.g. "Aplicação (email para contato técnico)".
 * Without a contact email (OAuth mode on a server that set none) the contact is
 * the Hay.chat site.
 */
export function userAgent(contactEmail: unknown): string {
  return `Hay (${isEmail(contactEmail) ? contactEmail.trim() : "https://hay.chat"})`;
}
