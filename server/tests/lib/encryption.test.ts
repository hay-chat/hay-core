import { describe, it, expect, beforeEach, afterAll, jest } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import {
  AuthStateEncryptedTransformer,
  CIPHERTEXT_PREFIX,
  decryptValue,
  encryptValue,
  looksLikeCiphertext,
} from "@server/lib/auth/utils/encryption";

const KEY = "k".repeat(32);
const OLD_KEY = "o".repeat(32);

describe("stored secret encryption", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "test", PLUGIN_ENCRYPTION_KEY: KEY };
    delete process.env.PLUGIN_ENCRYPTION_KEY_PREVIOUS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("round-trips and marks new ciphertext with a version prefix", () => {
    const cipher = encryptValue("sk_live_123");
    expect(cipher.startsWith(CIPHERTEXT_PREFIX)).toBe(true);
    expect(decryptValue(cipher)).toBe("sk_live_123");
  });

  it("still decrypts unprefixed ciphertext written before the prefix existed", () => {
    const legacy = encryptValue("token").slice(CIPHERTEXT_PREFIX.length);
    expect(decryptValue(legacy)).toBe("token");
  });

  it("decrypts with PLUGIN_ENCRYPTION_KEY_PREVIOUS during a key rotation", () => {
    process.env.PLUGIN_ENCRYPTION_KEY = OLD_KEY;
    const underOldKey = encryptValue("token");

    process.env.PLUGIN_ENCRYPTION_KEY = KEY;
    expect(() => decryptValue(underOldKey)).toThrow();

    process.env.PLUGIN_ENCRYPTION_KEY_PREVIOUS = OLD_KEY;
    expect(decryptValue(underOldKey)).toBe("token");
  });

  it("refuses the JWT_SECRET fallback in production", () => {
    delete process.env.PLUGIN_ENCRYPTION_KEY;
    process.env.JWT_SECRET = "j".repeat(64);
    process.env.NODE_ENV = "production";
    expect(() => encryptValue("x")).toThrow("PLUGIN_ENCRYPTION_KEY must be set");

    process.env.NODE_ENV = "development";
    expect(decryptValue(encryptValue("x"))).toBe("x");
  });

  it("tells ciphertext apart from legacy plaintext", () => {
    expect(looksLikeCiphertext(encryptValue("a"))).toBe(true);
    expect(looksLikeCiphertext(encryptValue("a").slice(CIPHERTEXT_PREFIX.length))).toBe(true);
    expect(looksLikeCiphertext("shpat_0123456789abcdef")).toBe(false);
    expect(looksLikeCiphertext("short")).toBe(false);
  });

  describe("AuthStateEncryptedTransformer.from", () => {
    const transformer = new AuthStateEncryptedTransformer();

    it("decrypts stored credentials", () => {
      const stored = transformer.to({ methodId: "apiKey", credentials: { apiKey: "secret" } });
      expect(transformer.from(stored)).toEqual({
        methodId: "apiKey",
        credentials: { apiKey: "secret" },
      });
    });

    it("never returns ciphertext it cannot decrypt as the credential", () => {
      process.env.PLUGIN_ENCRYPTION_KEY = OLD_KEY;
      const stored = transformer.to({ credentials: { apiKey: "secret" } });
      process.env.PLUGIN_ENCRYPTION_KEY = KEY;

      expect(transformer.from(stored)).toEqual({ credentials: { apiKey: null } });
    });

    it("passes legacy plaintext credentials through", () => {
      expect(transformer.from({ credentials: { apiKey: "plain-legacy-key" } })).toEqual({
        credentials: { apiKey: "plain-legacy-key" },
      });
    });
  });
});
