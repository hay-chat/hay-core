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
