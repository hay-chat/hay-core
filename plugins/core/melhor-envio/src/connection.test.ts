import { describe, it, expect } from "vitest";
import { defaultAuthMode, getAuthMode, readAccessToken, userAgent } from "./connection.js";

const config = (values: Record<string, unknown>) => ({
  getOptional: <T>(key: string) => values[key] as T | undefined,
});

describe("auth mode", () => {
  it("defaults to OAuth only when the server has the Melhor Envio app", () => {
    expect(defaultAuthMode({ MELHOR_ENVIO_OAUTH_CLIENT_ID: "123" })).toBe("oauth");
    expect(defaultAuthMode({ MELHOR_ENVIO_OAUTH_CLIENT_ID: " " })).toBe("token");
    expect(defaultAuthMode({})).toBe("token");
  });

  it("keeps the merchant's choice and ignores unknown values", () => {
    const env = { MELHOR_ENVIO_OAUTH_CLIENT_ID: "123" };
    expect(getAuthMode(config({ authMode: "token" }), env)).toBe("token");
    expect(getAuthMode(config({ authMode: "oauth" }), {})).toBe("oauth");
    expect(getAuthMode(config({ authMode: "other" }), env)).toBe("oauth");
  });
});

describe("readAccessToken", () => {
  it("trims the token and drops a copied Bearer prefix", () => {
    expect(readAccessToken(config({ accessToken: "  Bearer abc.def " }))).toBe("abc.def");
    expect(readAccessToken(config({}))).toBe("");
  });
});

describe("userAgent", () => {
  it("names the contact email, or the Hay.chat site when there is none", () => {
    expect(userAgent(" dev@store.example ")).toBe("Hay (dev@store.example)");
    expect(userAgent(undefined)).toBe("Hay (https://hay.chat)");
    expect(userAgent("not an email")).toBe("Hay (https://hay.chat)");
  });
});
