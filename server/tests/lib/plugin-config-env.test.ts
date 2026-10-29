/**
 * A plugin's config schema names env vars for server-managed values, but the
 * schema comes from the plugin worker. Only names the plugin's static manifest
 * declares (minus reserved and, for non-core plugins, secret-looking names)
 * resolve; OAuth endpoints are checked before core calls them.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { configEnvAllowList, isCoreReservedEnv } from "@server/lib/plugin-env";
import {
  managedFieldKeys,
  resolveConfigForWorker,
  resolveConfigWithEnv,
} from "@server/lib/config-resolver";
import { assertOAuthEndpoint, oauthEndpointPolicy } from "@server/lib/oauth-endpoint";
import { redactEmbeddedJsonFields } from "@server/lib/logger/redaction";
import type { ConfigFieldDescriptor } from "@server/types/plugin-sdk.types";

const corePlugin = (env: string[]) => ({ sourceType: "core", manifest: { permissions: { env } } });
const customPlugin = (env: string[]) => ({
  sourceType: "custom",
  manifest: { permissions: { env } },
});

describe("configEnvAllowList", () => {
  it("keeps a core plugin's declared managed secrets but never core's own settings", () => {
    const allowed = configEnvAllowList(
      corePlugin(["META_APP_ID", "META_APP_SECRET", "JWT_SECRET", "DB_PASSWORD", "HAY_API_TOKEN"]),
    );
    expect([...allowed].sort()).toEqual(["META_APP_ID", "META_APP_SECRET"]);
  });

  it("refuses secret-looking names for non-core plugins", () => {
    const allowed = configEnvAllowList(customPlugin(["ACME_REGION", "ACME_CLIENT_SECRET"]));
    expect([...allowed]).toEqual(["ACME_REGION"]);
  });

  it("allows nothing without a static manifest declaration", () => {
    expect(configEnvAllowList(corePlugin([])).size).toBe(0);
    expect(configEnvAllowList(null).size).toBe(0);
  });

  it("treats core infrastructure names as reserved", () => {
    for (const name of ["DB_HOST", "REDIS_PASSWORD", "OPENAI_API_KEY", "STRIPE_SECRET_KEY"]) {
      expect(isCoreReservedEnv(name)).toBe(true);
    }
    expect(isCoreReservedEnv("SHOPIFY_OAUTH_CLIENT_SECRET")).toBe(false);
  });
});

describe("config resolver env scoping", () => {
  const schema: Record<string, ConfigFieldDescriptor> = {
    stolen: { type: "string", label: "Stolen", env: "TEST_CORE_JWT_SECRET" },
    region: { type: "string", label: "Region", env: "TEST_PLUGIN_REGION" },
  };

  beforeEach(() => {
    process.env.TEST_CORE_JWT_SECRET = "core-secret";
    process.env.TEST_PLUGIN_REGION = "eu";
  });
  afterEach(() => {
    delete process.env.TEST_CORE_JWT_SECRET;
    delete process.env.TEST_PLUGIN_REGION;
  });

  it("resolves only allow-listed env vars", () => {
    const { values, metadata } = resolveConfigWithEnv({}, schema, {
      allowedEnv: new Set(["TEST_PLUGIN_REGION"]),
    });
    expect(values).toEqual({ stolen: undefined, region: "eu" });
    expect(metadata.stolen.envName).toBeUndefined();
    expect(metadata.stolen.hasEnvFallback).toBeUndefined();
    expect(metadata.region.source).toBe("env");
  });

  it("reads no env var when no allow-list is given", () => {
    const config = resolveConfigForWorker({}, null, schema);
    expect(JSON.stringify(config)).not.toContain("core-secret");
    expect(config.region).toBeUndefined();
    expect(managedFieldKeys(schema)).toEqual([]);
  });

  it("never resolves a reserved name even if a manifest declares it", () => {
    process.env.JWT_TEST_SECRET_FOR_PLUGIN = "core-secret";
    try {
      const allowedEnv = configEnvAllowList(corePlugin(["JWT_TEST_SECRET_FOR_PLUGIN"]));
      const { values } = resolveConfigWithEnv(
        {},
        { s: { type: "string", label: "S", env: "JWT_TEST_SECRET_FOR_PLUGIN" } },
        { allowedEnv },
      );
      expect(values.s).toBeUndefined();
    } finally {
      delete process.env.JWT_TEST_SECRET_FOR_PLUGIN;
    }
  });
});

describe("assertOAuthEndpoint", () => {
  const managed = oauthEndpointPolicy({
    managedSecret: true,
    declaredHosts: ["auth.example.com", "*.myshopify.com"],
  });
  const merchantOwned = oauthEndpointPolicy({ managedSecret: false, declaredHosts: undefined });

  it("accepts declared hosts for a managed secret", () => {
    expect(() => assertOAuthEndpoint("https://auth.example.com/token", managed)).not.toThrow();
    expect(() =>
      assertOAuthEndpoint("https://store.myshopify.com/admin/oauth/access_token", managed),
    ).not.toThrow();
  });

  it("rejects undeclared hosts for a managed secret", () => {
    for (const url of [
      "https://elsewhere.example.net/token",
      "https://myshopify.com/admin/oauth/access_token",
      "https://store.myshopify.com.example.net/token",
    ]) {
      expect(() => assertOAuthEndpoint(url, managed)).toThrow(/not declared/);
    }
  });

  it("rejects managed secrets when the manifest declares no hosts", () => {
    const policy = oauthEndpointPolicy({ managedSecret: true, declaredHosts: undefined });
    expect(() => assertOAuthEndpoint("https://auth.example.com/token", policy)).toThrow();
  });

  it("requires a plain https URL in every case", () => {
    for (const url of [
      "http://auth.example.com/token",
      "https://auth.example.com:8443/token",
      "https://user:pass@auth.example.com/token",
      "not a url",
    ]) {
      expect(() => assertOAuthEndpoint(url, merchantOwned)).toThrow();
    }
    expect(() => assertOAuthEndpoint("https://any.example.org/token", merchantOwned)).not.toThrow();
  });
});

describe("redactEmbeddedJsonFields", () => {
  it("masks sensitive JSON fields in worker log lines", () => {
    const line =
      '[2026-01-01T00:00:00Z] [plugin:x] INFO: Loaded {"apiKey":"abc123","region":"eu","clientSecret":"s\\"x"}';
    const redacted = redactEmbeddedJsonFields(line);
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain('s\\"x');
    expect(redacted).toContain('"region":"eu"');
  });
});
