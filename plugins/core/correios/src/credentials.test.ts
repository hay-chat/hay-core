import { describe, it, expect } from "vitest";
import {
  basicAuth,
  credentialsEnv,
  missingCredentials,
  readCredentials,
  tokenRequest,
} from "./credentials";

const config = (values: Record<string, unknown>) => ({
  getOptional: <T = unknown>(key: string) => values[key] as T | undefined,
});

const BASE = { username: " 12345678000190 ", accessCode: "code" };

describe("readCredentials", () => {
  it("needs the user, the access code and a posting card or contract", () => {
    expect(readCredentials(config({}))).toBeNull();
    expect(missingCredentials(config({ username: "u" }))).toMatch(/access code/);
    expect(readCredentials(config(BASE))).toBeNull();
    expect(missingCredentials(config(BASE))).toMatch(/cartão de postagem/);
    expect(missingCredentials(config({ ...BASE, postingCard: "   " }))).toMatch(/cartão/);
  });

  it("trims values and accepts a number typed into a text field", () => {
    expect(readCredentials(config({ ...BASE, postingCard: 12345678 }))).toEqual({
      username: "12345678000190",
      accessCode: "code",
      postingCard: "12345678",
      contract: undefined,
    });
  });
});

describe("tokenRequest", () => {
  it("authorises by cartão de postagem when there is one, else by contract", () => {
    const creds = { username: "u", accessCode: "c" };
    expect(tokenRequest({ ...creds, postingCard: "0012345678" })).toEqual({
      path: "/token/v1/autentica/cartaopostagem",
      body: { numero: "0012345678" },
    });
    expect(tokenRequest({ ...creds, postingCard: "0012345678", contract: "99" })).toEqual({
      path: "/token/v1/autentica/cartaopostagem",
      body: { numero: "0012345678", contrato: "99" },
    });
    expect(tokenRequest({ ...creds, contract: "99" })).toEqual({
      path: "/token/v1/autentica/contrato",
      body: { numero: "99" },
    });
  });
});

describe("basicAuth and credentialsEnv", () => {
  it("encodes user:accessCode and passes only the set values to the MCP server", () => {
    const creds = { username: "u", accessCode: "c", contract: "99" };
    expect(basicAuth(creds)).toBe(`Basic ${Buffer.from("u:c").toString("base64")}`);
    expect(credentialsEnv(creds)).toEqual({
      CORREIOS_USERNAME: "u",
      CORREIOS_ACCESS_CODE: "c",
      CORREIOS_CONTRACT: "99",
    });
  });
});
