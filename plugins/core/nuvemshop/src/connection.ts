/**
 * How a Nuvemshop store is connected, and where its credentials come from.
 *
 * - `oauth` (Hay.chat partner app): the merchant clicks Connect. Core runs the
 *   OAuth flow and stores the token; the token response's `user_id` is the
 *   store id, kept by core in the credentials and saved as `storeId` by
 *   `onConnected`. Core merges both into the config the plugin reads.
 * - `token` (custom app, "Aplicativos a medida"): the merchant pastes the store
 *   id and an access token. Kept as the fallback for stores outside the
 *   partner app and for servers without NUVEMSHOP_OAUTH_CLIENT_ID.
 */

export type AuthMode = "oauth" | "token";

export interface NuvemshopCredentials {
  storeId: string;
  accessToken: string;
}

interface ConfigReader {
  getOptional: <T = unknown>(key: string) => T | undefined;
}

/** Default when the merchant has not picked a mode: OAuth when this server has the partner app. */
export function defaultAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  return env.NUVEMSHOP_OAUTH_CLIENT_ID?.trim() ? "oauth" : "token";
}

export function getAuthMode(config: ConfigReader, env: NodeJS.ProcessEnv = process.env): AuthMode {
  const mode = config.getOptional<string>("authMode");
  if (mode === "oauth" || mode === "token") return mode;
  return defaultAuthMode(env);
}

function text(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * The store id of an OAuth connection: `storeId` once `onConnected` saved it,
 * else the raw token-response fields core kept (`user_id`, or `store_id`).
 */
export function oauthStoreId(config: ConfigReader): string | undefined {
  return (
    text(config.getOptional("storeId")) ??
    text(config.getOptional("user_id")) ??
    text(config.getOptional("store_id"))
  );
}

/** Credentials for the active mode, or null when the store is not connected yet. */
export function readCredentials(
  config: ConfigReader,
  env: NodeJS.ProcessEnv = process.env,
): NuvemshopCredentials | null {
  const accessToken = text(config.getOptional("accessToken"));
  const storeId =
    getAuthMode(config, env) === "oauth"
      ? oauthStoreId(config)
      : text(config.getOptional("storeId"));
  if (!storeId || !accessToken) return null;
  return { storeId, accessToken };
}
