import crypto from "crypto";
import { describe, it, expect, beforeEach, afterAll, jest } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import {
  AuthStateEncryptedTransformer,
  CIPHERTEXT_PREFIX,
  decryptValue,
  encryptValue,
  isCurrentCiphertext,
  LEGACY_CIPHERTEXT_PREFIX,
  looksLikeCiphertext,
} from "@server/lib/auth/utils/encryption";

const KEY = "k".repeat(32);
const OLD_KEY = "o".repeat(32);

/** Output of the previous format: PBKDF2 per value, salt + iv + tag + ciphertext. */
function legacyCiphertext(text: string, password: string): string {
  const salt = crypto.randomBytes(64);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256"),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

describe("stored secret encryption", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "test", PLUGIN_ENCRYPTION_KEY: KEY };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("round-trips and marks new ciphertext with a version prefix", () => {
    const cipher = encryptValue("sk_live_123");
    expect(cipher.startsWith(CIPHERTEXT_PREFIX)).toBe(true);
    expect(decryptValue(cipher)).toBe("sk_live_123");
  });

  it("still decrypts both earlier formats", () => {
    const legacy = legacyCiphertext("token", KEY);
    expect(decryptValue(legacy)).toBe("token");
    expect(decryptValue(LEGACY_CIPHERTEXT_PREFIX + legacy)).toBe("token");
  });

  it("names the key it wrote with and reads under a rotated key ring", () => {
    const underSingleKey = encryptValue("token");
    expect(underSingleKey.startsWith(`${CIPHERTEXT_PREFIX}k0:`)).toBe(true);
    const legacy = legacyCiphertext("old-format", KEY);

    process.env.PLUGIN_ENCRYPTION_KEYS = `k1:${OLD_KEY}`;
    expect(encryptValue("x").startsWith(`${CIPHERTEXT_PREFIX}k1:`)).toBe(true);
    expect(isCurrentCiphertext(underSingleKey)).toBe(false);
    expect(decryptValue(underSingleKey)).toBe("token");
    expect(decryptValue(legacy)).toBe("old-format");

    delete process.env.PLUGIN_ENCRYPTION_KEY;
    expect(() => decryptValue(underSingleKey)).toThrow('id "k0"');
    expect(() => decryptValue(legacy)).toThrow();
  });

  it("rejects a value whose key id was changed", () => {
    process.env.PLUGIN_ENCRYPTION_KEYS = `k1:${OLD_KEY},k2:${OLD_KEY}`;
    const cipher = encryptValue("token");
    expect(() => decryptValue(cipher.replace(":k1:", ":k2:"))).toThrow();
  });

  it("does not fall back to JWT_SECRET when NODE_ENV is unset", () => {
    delete process.env.PLUGIN_ENCRYPTION_KEY;
    delete process.env.NODE_ENV;
    process.env.JWT_SECRET = "j".repeat(64);
    expect(() => encryptValue("x")).toThrow("PLUGIN_ENCRYPTION_KEY must be set");
  });

  it("cannot decrypt values encrypted under another key", () => {
    process.env.PLUGIN_ENCRYPTION_KEY = OLD_KEY;
    const underOldKey = encryptValue("token");

    process.env.PLUGIN_ENCRYPTION_KEY = KEY;
    expect(() => decryptValue(underOldKey)).toThrow();
  });

  it("refuses the JWT_SECRET fallback in production", () => {
    delete process.env.PLUGIN_ENCRYPTION_KEY;
    process.env.JWT_SECRET = "j".repeat(64);
    process.env.NODE_ENV = "production";
    expect(() => encryptValue("x")).toThrow("PLUGIN_ENCRYPTION_KEY must be set");

    process.env.NODE_ENV = "development";
    expect(decryptValue(encryptValue("x"))).toBe("x");
  });

  it("derives a legacy value's key once, even when decryption fails", () => {
    const readable = legacyCiphertext("reused", KEY);
    const unreadable = legacyCiphertext("other-key", "a-different-key");
    const derive = jest.spyOn(crypto, "pbkdf2Sync");
    try {
      expect(decryptValue(readable)).toBe("reused");
      expect(decryptValue(readable)).toBe("reused");
      expect(derive).toHaveBeenCalledTimes(1);

      derive.mockClear();
      expect(() => decryptValue(unreadable)).toThrow();
      expect(() => decryptValue(unreadable)).toThrow();
      expect(derive).toHaveBeenCalledTimes(1);
    } finally {
      derive.mockRestore();
    }
  });

  it("tells ciphertext apart from legacy plaintext", () => {
    expect(looksLikeCiphertext(encryptValue("a"))).toBe(true);
    expect(looksLikeCiphertext(legacyCiphertext("a", KEY))).toBe(true);
    expect(looksLikeCiphertext(LEGACY_CIPHERTEXT_PREFIX + "x")).toBe(true);
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

    it("refuses plaintext credentials once ciphertext is required", () => {
      process.env.PLUGIN_ENCRYPTION_REQUIRE_CIPHERTEXT = "true";
      expect(transformer.from({ credentials: { apiKey: "plain-legacy-key" } })).toEqual({
        credentials: { apiKey: null },
      });
    });
  });
});
