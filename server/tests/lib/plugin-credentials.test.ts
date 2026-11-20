import { describe, it, expect } from "@jest/globals";
import {
  isSecretField,
  parseCredentialDeclarations,
  workerAuthCredentials,
} from "@server/lib/plugin-credentials";

describe("parseCredentialDeclarations", () => {
  const ok = { name: "apiKey", source: "config", capability: "mcp", hosts: ["api.example.com"] };

  it("accepts config secrets, the auth bundle and config-derived hosts", () => {
    const parsed = parseCredentialDeclarations([
      ok,
      { name: "auth", source: "auth", capability: "messages", hosts: [{ fromConfig: "baseUrl" }] },
    ]);
    expect(parsed).toHaveLength(2);
  });

  it("allows the server-wide env fallback unless a credential opts out of it", () => {
    const parsed = parseCredentialDeclarations([ok, { ...ok, name: "ownKey", allowEnv: false }]);
    expect(parsed.map((entry) => entry.allowEnv)).toEqual([true, false]);
  });

  it("treats a missing list as no credentials", () => {
    expect(parseCredentialDeclarations(undefined)).toEqual([]);
  });

  it.each([
    ["not a list", {}],
    ["a refresh token", [{ ...ok, name: "refreshToken" }]],
    ["a repeated name", [ok, ok]],
    ["an unknown capability", [{ ...ok, capability: "root" }]],
    ["a bad source", [{ ...ok, source: "env" }]],
    ["an allowEnv that is not a boolean", [{ ...ok, allowEnv: "no" }]],
    ["auth under another name", [{ ...ok, source: "auth" }]],
    ["a config credential named auth", [{ ...ok, name: "auth" }]],
    ["a bad name", [{ ...ok, name: "a b" }]],
    ["a bad host", [{ ...ok, hosts: ["not a host!"] }]],
    ["hosts that are not a list", [{ ...ok, hosts: "x" }]],
    ["an entry that is not an object", ["apiKey"]],
  ])("rejects %s", (_label, value) => {
    expect(() => parseCredentialDeclarations(value)).toThrow();
  });
});

describe("what a worker may hold", () => {
  it("treats only encrypted fields as secret", () => {
    expect(isSecretField({ type: "string", label: "x", encrypted: true })).toBe(true);
    expect(isSecretField({ type: "string", label: "x" })).toBe(false);
    expect(isSecretField(undefined)).toBe(false);
  });

  it("drops the refresh token and server-only keys from an account's credentials", () => {
    expect(
      workerAuthCredentials(
        { accessToken: "a", refreshToken: "r", clientSecret: "s", clientId: "c" },
        { clientSecret: { type: "string", label: "s", serverOnly: true } },
        new Set(),
      ),
    ).toEqual({ accessToken: "a", clientId: "c" });
  });

  it("keeps a secret config field out of the auth bundle unless the plugin declared it", () => {
    const schema = {
      apiKey: { type: "string" as const, label: "k", encrypted: true },
      other: { type: "string" as const, label: "o", encrypted: true },
      region: { type: "string" as const, label: "r" },
    };
    const stored = { apiKey: "k", other: "o", region: "eu", accessToken: "t" };
    expect(workerAuthCredentials(stored, schema, new Set(["apiKey"]))).toEqual({
      apiKey: "k",
      region: "eu",
      accessToken: "t",
    });
  });
});
