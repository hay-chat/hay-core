import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLegacyRefreshToken,
  extractLegacyTokens,
  getLegacyRefreshToken,
} from "./legacy-session";

function memoryStorage(initial: string | null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
}

describe("extractLegacyTokens", () => {
  beforeEach(() => clearLegacyRefreshToken());

  it("erases tokens from storage and keeps the refresh token in memory only", () => {
    const storage = memoryStorage(
      JSON.stringify({
        tokens: { accessToken: "a", refreshToken: "hrt1.old", expiresAt: 1 },
        isAuthenticated: true,
      }),
    );

    extractLegacyTokens(storage);

    expect(storage.read()).toBe(JSON.stringify({ isAuthenticated: true }));
    expect(storage.read()).not.toContain("hrt1.old");
    expect(getLegacyRefreshToken()).toBe("hrt1.old");
  });

  it("leaves already-migrated state alone", () => {
    const stored = JSON.stringify({ isAuthenticated: true });
    const storage = memoryStorage(stored);
    extractLegacyTokens(storage);
    expect(storage.read()).toBe(stored);
    expect(getLegacyRefreshToken()).toBeUndefined();
  });

  it("ignores unreadable state", () => {
    const storage = memoryStorage("{not json");
    expect(() => extractLegacyTokens(storage)).not.toThrow();
    expect(getLegacyRefreshToken()).toBeUndefined();
  });
});
