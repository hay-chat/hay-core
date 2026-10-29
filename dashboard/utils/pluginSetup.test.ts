import { describe, expect, it } from "vitest";
import {
  deriveSetupState,
  describedCapabilities,
  missingRequiredFields,
  splitConfigFields,
  type ConfigFieldMeta,
} from "./pluginSetup";

describe("describedCapabilities", () => {
  it("reads SDK array capabilities and drops plumbing ones", () => {
    expect(describedCapabilities(["mcp", "auth", "cron", "disputes"])).toEqual(["mcp", "disputes"]);
    expect(describedCapabilities(["messages", "customers"])).toEqual(["messages", "customers"]);
  });

  it("maps legacy object capabilities", () => {
    expect(
      describedCapabilities({
        chat_connector: { features: {} },
        document_importer: {},
        mcp: false,
      }),
    ).toEqual(["messages", "documents"]);
  });

  it("returns nothing for missing capabilities", () => {
    expect(describedCapabilities(undefined)).toEqual([]);
    expect(describedCapabilities(["config"])).toEqual([]);
  });
});

const schema = {
  shopDomain: { required: true },
  clientId: { required: true },
  apiVersion: { advanced: true },
  authMode: { required: true, advanced: true },
  token: { required: true, showWhen: { field: "authMode", equals: "token" } },
};
const meta: Record<string, ConfigFieldMeta> = {
  shopDomain: { source: "database", canOverride: true, advanced: false },
  clientId: { source: "env", canOverride: false, managed: true, advanced: true },
  apiVersion: { source: "default", canOverride: true, advanced: true },
  authMode: { source: "database", canOverride: true, advanced: true },
  token: { source: "database", canOverride: true, advanced: false },
};

describe("missingRequiredFields", () => {
  it("skips managed, hidden and filled fields; masked secrets count as set", () => {
    expect(missingRequiredFields(schema, meta, { authMode: "oauth" })).toEqual(["shopDomain"]);
    expect(
      missingRequiredFields(schema, meta, { authMode: "token", shopDomain: "x", token: "********" }),
    ).toEqual([]);
  });
});

describe("splitConfigFields", () => {
  it("puts managed and declared-advanced fields on Advanced", () => {
    expect(splitConfigFields(schema, meta, { authMode: "oauth", shopDomain: "x" })).toEqual({
      setup: ["shopDomain", "token"],
      advanced: ["clientId", "apiVersion", "authMode"],
    });
  });

  it("keeps a required advanced field in Setup while it has no value", () => {
    expect(splitConfigFields(schema, meta, {}).setup).toContain("authMode");
  });
});

describe("deriveSetupState", () => {
  const base = { enabled: true, missingRequired: 0 };

  it("is not set up until the plugin is connected", () => {
    expect(deriveSetupState({ ...base, enabled: false })).toBe("not_set_up");
  });

  it("needs action while a required field or the OAuth connection is missing", () => {
    expect(deriveSetupState({ ...base, missingRequired: 1 })).toBe("needs_action");
    expect(deriveSetupState({ ...base, oauth: { available: true, connected: false } })).toBe(
      "needs_action",
    );
    expect(deriveSetupState({ ...base, test: { success: false, status: "unconfigured" } })).toBe(
      "needs_action",
    );
  });

  it("is in error when the channel fails or the connection test fails", () => {
    expect(deriveSetupState({ ...base, channelFailing: true })).toBe("error");
    expect(deriveSetupState({ ...base, test: { success: false } })).toBe("error");
  });

  it("trusts what the plugin reports", () => {
    expect(deriveSetupState({ ...base, missingRequired: 1, reported: "connected" })).toBe(
      "connected",
    );
    expect(deriveSetupState({ ...base, reported: "not_set_up" })).toBe("needs_action");
  });

  it("is connected otherwise", () => {
    expect(deriveSetupState({ ...base, oauth: { available: true, connected: true } })).toBe(
      "connected",
    );
  });
});
