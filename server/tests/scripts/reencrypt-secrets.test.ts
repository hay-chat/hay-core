import { describe, it, expect, beforeEach, afterAll, jest } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("../../database/data-source", () => ({ AppDataSource: {} }));

import { decryptValue, encryptValue } from "@server/lib/auth/utils/encryption";
import { rotateSecret } from "../../scripts/reencrypt-secrets";

const NEW_KEY = "n".repeat(32);
const OLD_KEY = "o".repeat(32);

describe("rotateSecret", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "test", PLUGIN_ENCRYPTION_KEY: OLD_KEY };
    delete process.env.PLUGIN_ENCRYPTION_KEY_PREVIOUS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function rotateToNewKey() {
    process.env.PLUGIN_ENCRYPTION_KEY = NEW_KEY;
    process.env.PLUGIN_ENCRYPTION_KEY_PREVIOUS = OLD_KEY;
  }

  it("re-encrypts a value under the previous key so the new key alone opens it", () => {
    const stored = encryptValue("sk_live_123");
    rotateToNewKey();

    const { outcome, next } = rotateSecret(stored);
    expect(outcome).toBe("reencrypted");

    delete process.env.PLUGIN_ENCRYPTION_KEY_PREVIOUS;
    expect(decryptValue(next!)).toBe("sk_live_123");
  });

  it("leaves values already under the current key alone", () => {
    rotateToNewKey();
    expect(rotateSecret(encryptValue("x"))).toEqual({ outcome: "unchanged", next: null });
  });

  it("encrypts legacy plaintext credentials only when allowed", () => {
    rotateToNewKey();
    const credential = rotateSecret("plain-legacy-key", true);
    expect(credential.outcome).toBe("encrypted-plaintext");
    expect(decryptValue(credential.next!)).toBe("plain-legacy-key");

    expect(rotateSecret("plain-legacy-key")).toEqual({ outcome: "failed", next: null });
  });

  it("reports ciphertext that neither key opens", () => {
    process.env.PLUGIN_ENCRYPTION_KEY = "u".repeat(32);
    const unknown = encryptValue("x");
    rotateToNewKey();
    expect(rotateSecret(unknown, true)).toEqual({ outcome: "failed", next: null });
  });
});
