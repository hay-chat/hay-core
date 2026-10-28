import { describe, it, expect } from "@jest/globals";
import { mergeWithStoredConfig, separateConfigAndAuth } from "../../lib/plugin-utils";
import type { PluginMetadata } from "../../types/plugin-sdk.types";

const metadata = {
  configSchema: {
    siteUrl: { type: "string" },
    consumerKey: { type: "string", encrypted: true },
    consumerSecret: { type: "string", encrypted: true },
  },
  authMethods: [{ id: "apikey", type: "apiKey", configField: "consumerKey" }],
} as unknown as PluginMetadata;

describe("mergeWithStoredConfig", () => {
  const stored = { siteUrl: "https://shop.test", consumerKey: "ck_1", consumerSecret: "cs_1" };

  it("keeps stored secrets when the form sends them masked", () => {
    const merged = mergeWithStoredConfig(
      {
        siteUrl: "https://shop.test",
        consumerKey: "********",
        consumerSecret: "********",
        note: "x",
      },
      stored,
      undefined,
    );
    const { authState } = separateConfigAndAuth(merged, metadata);
    expect(authState?.credentials).toEqual({ consumerKey: "ck_1", consumerSecret: "cs_1" });
  });

  it("keeps stored secrets when the form omits them", () => {
    const merged = mergeWithStoredConfig({ note: "x" }, stored, undefined);
    expect(merged).toMatchObject({ consumerKey: "ck_1", consumerSecret: "cs_1", note: "x" });
  });

  it("takes a newly typed secret", () => {
    const merged = mergeWithStoredConfig({ consumerKey: "ck_2" }, stored, undefined);
    expect(merged.consumerKey).toBe("ck_2");
  });

  it("drops an omitted field that has an env fallback set", () => {
    process.env.TEST_SITE_URL_FALLBACK = "https://env.test";
    const merged = mergeWithStoredConfig({}, stored, {
      siteUrl: { env: "TEST_SITE_URL_FALLBACK" },
    });
    delete process.env.TEST_SITE_URL_FALLBACK;
    expect("siteUrl" in merged).toBe(false);
  });
});
