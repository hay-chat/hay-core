import { describe, expect, it } from "vitest";
import { defaultAuthMode, getAuthMode, oauthStoreId, readCredentials } from "./connection.js";

const config = (values: Record<string, unknown>) => ({
  getOptional: <T = unknown>(key: string) => values[key] as T | undefined,
});

const withApp = { clientId: "1234" };

describe("auth mode", () => {
  it("defaults to oauth only when the server has the partner app", () => {
    expect(defaultAuthMode(config(withApp))).toBe("oauth");
    expect(defaultAuthMode(config({}))).toBe("token");
    expect(defaultAuthMode(config({ clientId: "  " }))).toBe("token");
  });

  it("uses the merchant's choice when set", () => {
    expect(getAuthMode(config({ ...withApp, authMode: "token" }))).toBe("token");
    expect(getAuthMode(config({ authMode: "oauth" }))).toBe("oauth");
    expect(getAuthMode(config({ ...withApp, authMode: "bogus" }))).toBe("oauth");
  });
});

describe("readCredentials", () => {
  it("token mode reads the pasted store id and token", () => {
    expect(
      readCredentials(config({ authMode: "token", storeId: " 42 ", accessToken: " tok " })),
    ).toEqual({ storeId: "42", accessToken: "tok" });
    expect(readCredentials(config({ authMode: "token", accessToken: "tok" }))).toBeNull();
  });

  it("oauth mode reads the store id saved by onConnected, else the token response's user_id", () => {
    expect(
      readCredentials(config({ authMode: "oauth", storeId: "789", accessToken: "t" })),
    ).toEqual({ storeId: "789", accessToken: "t" });
    expect(
      readCredentials(config({ authMode: "oauth", user_id: "789", accessToken: "t" })),
    ).toEqual({ storeId: "789", accessToken: "t" });
    expect(oauthStoreId(config({ store_id: 789 }))).toBe("789");
  });

  it("oauth mode is not connected before the token exists", () => {
    expect(readCredentials(config({ authMode: "oauth", user_id: "789" }))).toBeNull();
    expect(readCredentials(config({ ...withApp }))).toBeNull();
  });
});
