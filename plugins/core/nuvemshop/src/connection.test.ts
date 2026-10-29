import { describe, expect, it } from "vitest";
import { defaultAuthMode, getAuthMode, oauthStoreId, readCredentials } from "./connection.js";

const config = (values: Record<string, unknown>) => ({
  getOptional: <T = unknown>(key: string) => values[key] as T | undefined,
});

const withApp = { NUVEMSHOP_OAUTH_CLIENT_ID: "1234" } as NodeJS.ProcessEnv;
const withoutApp = {} as NodeJS.ProcessEnv;

describe("auth mode", () => {
  it("defaults to oauth only when the server has the partner app", () => {
    expect(defaultAuthMode(withApp)).toBe("oauth");
    expect(defaultAuthMode(withoutApp)).toBe("token");
    expect(defaultAuthMode({ NUVEMSHOP_OAUTH_CLIENT_ID: "  " } as NodeJS.ProcessEnv)).toBe("token");
  });

  it("uses the merchant's choice when set", () => {
    expect(getAuthMode(config({ authMode: "token" }), withApp)).toBe("token");
    expect(getAuthMode(config({ authMode: "oauth" }), withoutApp)).toBe("oauth");
    expect(getAuthMode(config({ authMode: "bogus" }), withApp)).toBe("oauth");
  });
});

describe("readCredentials", () => {
  it("token mode reads the pasted store id and token", () => {
    expect(
      readCredentials(
        config({ authMode: "token", storeId: " 42 ", accessToken: " tok " }),
        withApp,
      ),
    ).toEqual({ storeId: "42", accessToken: "tok" });
    expect(readCredentials(config({ authMode: "token", accessToken: "tok" }), withApp)).toBeNull();
  });

  it("oauth mode reads the store id saved by onConnected, else the token response's user_id", () => {
    expect(
      readCredentials(config({ authMode: "oauth", storeId: "789", accessToken: "t" }), withApp),
    ).toEqual({ storeId: "789", accessToken: "t" });
    expect(
      readCredentials(config({ authMode: "oauth", user_id: "789", accessToken: "t" }), withApp),
    ).toEqual({ storeId: "789", accessToken: "t" });
    expect(oauthStoreId(config({ store_id: 789 }))).toBe("789");
  });

  it("oauth mode is not connected before the token exists", () => {
    expect(readCredentials(config({ authMode: "oauth", user_id: "789" }), withApp)).toBeNull();
    expect(readCredentials(config({}), withApp)).toBeNull();
  });
});
