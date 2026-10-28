import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { mockShopify } = require("./harness");
const { requireScopes, hasScope, resetScopeCache } = require("../lib/scopes");

const grant = (...handles) => ({
  AppScopes: () => ({
    currentAppInstallation: { accessScopes: handles.map((handle) => ({ handle })) },
  }),
});

describe("requireScopes", () => {
  beforeEach(() => resetScopeCache());

  it("passes when every scope is granted (write implies read)", async () => {
    mockShopify(grant("write_orders", "write_order_edits"));
    await expect(requireScopes(["read_orders", "write_order_edits"])).resolves.toBeUndefined();
  });

  it("throws SCOPE_MISSING naming the missing scopes and asking for re-approval", async () => {
    mockShopify(grant("write_orders"));
    const err = await requireScopes(["write_orders", "write_order_edits"]).catch((e) => e);
    expect(err.code).toBe("SCOPE_MISSING");
    expect(err.message).toMatch(/re-approve Hay\.chat/);
    expect(err.details.missingScopes).toEqual(["write_order_edits"]);
  });

  it("asks Shopify once per process", async () => {
    const { calls } = mockShopify(grant("write_orders"));
    await requireScopes(["read_orders"]);
    await requireScopes(["write_orders"]);
    expect(calls).toHaveLength(1);
  });

  it("does not treat read as implying write", () => {
    expect(hasScope(new Set(["read_returns"]), "write_returns")).toBe(false);
  });
});
