/**
 * Earlier builds kept the refresh token in localStorage. Move it out once: the
 * first refresh trades it for the cookie, and the stored copy is erased now.
 * TODO: remove 30 days after this ships, when every such token has expired.
 */
const AUTH_STORAGE_KEY = "auth";

let legacyRefreshToken: string | null = null;

/** Erase tokens from the persisted auth state, keeping the refresh token in memory. */
export function extractLegacyTokens(storage: Pick<Storage, "getItem" | "setItem">): void {
  try {
    const raw = storage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    const { tokens, ...rest } = JSON.parse(raw) as {
      tokens?: { refreshToken?: unknown } | null;
    } & Record<string, unknown>;
    if (tokens === undefined) return;
    if (typeof tokens?.refreshToken === "string") legacyRefreshToken = tokens.refreshToken;
    storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // Unreadable state holds nothing to migrate.
  }
}

export function getLegacyRefreshToken(): string | undefined {
  return legacyRefreshToken ?? undefined;
}

export function clearLegacyRefreshToken(): void {
  legacyRefreshToken = null;
}
