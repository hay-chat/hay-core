import type { ConnectedAccount } from "../types/plugin-sdk.types";

/**
 * Validate the account a plugin reports from `onConnected`. The value comes
 * from plugin code, so only a non-empty string label (capped) and an http(s)
 * avatar URL are accepted; anything else is dropped.
 */
export function parseConnectedAccount(value: unknown): ConnectedAccount | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { label, avatarUrl } = value as Record<string, unknown>;
  if (typeof label !== "string" || label.trim() === "") return undefined;
  const safeAvatar =
    typeof avatarUrl === "string" && /^https?:\/\//.test(avatarUrl) ? avatarUrl : undefined;
  return { label: label.slice(0, 200), avatarUrl: safeAvatar };
}

/** Credential keys owned by core's OAuth flow; a plugin may never overwrite them. */
const RESERVED_CREDENTIAL_KEYS = new Set([
  "accessToken",
  "refreshToken",
  "expiresAt",
  "connectedAt",
  "tokenType",
  "scope",
]);
const CREDENTIAL_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_CREDENTIAL_VALUE_LENGTH = 4096;
const MAX_CREDENTIAL_KEYS = 20;

/**
 * Validate the credentials a plugin returns from `onConnected` (connection
 * data it derived, e.g. provider account ids). Reserved OAuth keys, malformed
 * keys and non-string or oversized values are dropped; at most 20 keys are kept.
 */
export function parseConnectedCredentials(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const credentials: Record<string, string> = {};
  let count = 0;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_CREDENTIAL_KEYS) break;
    if (RESERVED_CREDENTIAL_KEYS.has(key) || !CREDENTIAL_KEY_PATTERN.test(key)) continue;
    if (typeof val !== "string" || val.length > MAX_CREDENTIAL_VALUE_LENGTH) continue;
    credentials[key] = val;
    count++;
  }
  return count > 0 ? credentials : undefined;
}
