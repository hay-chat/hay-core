import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { dropManagedOverrides, resolveConfigWithEnv } from "../../lib/config-resolver";
import type { ConfigFieldDescriptor } from "../../types/plugin-sdk.types";

const schema: Record<string, ConfigFieldDescriptor> = {
  clientId: { type: "string", label: "Client ID", env: "D20_TEST_CLIENT_ID" },
  clientSecret: { type: "string", label: "Secret", env: "D20_TEST_CLIENT_SECRET", encrypted: true },
  apiVersion: { type: "string", label: "API version", advanced: true, default: "2026-04" },
  shopDomain: { type: "string", label: "Store domain" },
};

const allowedEnv = new Set(["D20_TEST_CLIENT_ID", "D20_TEST_CLIENT_SECRET"]);

describe("config resolver: managed values (D20)", () => {
  beforeEach(() => {
    process.env.D20_TEST_CLIENT_ID = "hay-app";
    delete process.env.D20_TEST_CLIENT_SECRET; // self-hosting: not managed
    delete process.env.PLUGIN_ALLOW_MANAGED_OVERRIDE;
  });
  afterEach(() => {
    delete process.env.D20_TEST_CLIENT_ID;
    delete process.env.PLUGIN_ALLOW_MANAGED_OVERRIDE;
  });

  it("marks a field managed and advanced when its env var is set", () => {
    const { metadata, values } = resolveConfigWithEnv({}, schema, {
      maskSecrets: true,
      allowedEnv,
    });
    expect(values.clientId).toBeUndefined();
    expect(metadata.clientId).toMatchObject({
      source: "env",
      managed: true,
      advanced: true,
      envName: "D20_TEST_CLIENT_ID",
      canOverride: false,
    });
  });

  it("keeps an env field with no env value in Setup (self-hosting)", () => {
    const { metadata } = resolveConfigWithEnv({}, schema, { allowedEnv });
    expect(metadata.clientSecret).toMatchObject({
      managed: false,
      advanced: false,
      envName: "D20_TEST_CLIENT_SECRET",
    });
  });

  it("marks declared advanced fields and leaves plain ones alone", () => {
    const { metadata } = resolveConfigWithEnv({}, schema, { allowedEnv });
    expect(metadata.apiVersion).toMatchObject({ advanced: true, managed: false });
    expect(metadata.shopDomain).toMatchObject({ advanced: false, managed: false });
    expect(metadata.shopDomain.envName).toBeUndefined();
  });

  it("lets a merchant override a managed value only when the instance allows it", () => {
    process.env.PLUGIN_ALLOW_MANAGED_OVERRIDE = "true";
    expect(resolveConfigWithEnv({}, schema, { allowedEnv }).metadata.clientId.canOverride).toBe(
      true,
    );
  });

  it("keeps a stored override visible as the merchant's, with a way back", () => {
    const { metadata } = resolveConfigWithEnv({ clientId: "own-app" }, schema, { allowedEnv });
    expect(metadata.clientId).toMatchObject({
      source: "database",
      managed: true,
      hasEnvFallback: true,
    });
  });

  describe("dropManagedOverrides", () => {
    const input = { clientId: "own-app", clientSecret: "s", shopDomain: "x.myshopify.com" };

    it("drops managed values when overriding is off", () => {
      expect(dropManagedOverrides(input, schema, allowedEnv)).toEqual({
        clientSecret: "s",
        shopDomain: "x.myshopify.com",
      });
    });

    it("keeps them when the instance allows overriding", () => {
      process.env.PLUGIN_ALLOW_MANAGED_OVERRIDE = "true";
      expect(dropManagedOverrides(input, schema, allowedEnv)).toEqual(input);
    });
  });
});
