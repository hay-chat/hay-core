/**
 * Stripe's hosted MCP server: money moves must stay money categories (held for
 * approval), and the declaration must reach startExternal.
 */
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import plugin, { STRIPE_TOOL_RISK } from "../index.js";

const { normalizeToolRiskSpec, withToolRisk, CATEGORY_META_KEY } = createRequire(import.meta.url)(
  "@hay/plugin-sdk/tool-risk",
);

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe("Stripe tool risk", () => {
  it("is a valid declaration", () => {
    expect(() => normalizeToolRiskSpec(STRIPE_TOOL_RISK)).not.toThrow();
  });

  it("keeps refunds, cancels and coupons in money categories", () => {
    expect(STRIPE_TOOL_RISK.write).toMatchObject({
      create_refund: "refund",
      cancel_subscription: "cancel",
      create_coupon: "discount",
    });
  });

  it("leaves billing changes undeclared so they stay held", () => {
    const [tool] = withToolRisk([{ name: "update_subscription" }], STRIPE_TOOL_RISK);
    expect(tool.annotations).toBeUndefined();
    expect(tool._meta?.[CATEGORY_META_KEY]).toBeUndefined();
  });

  it("passes the declaration to startExternal", async () => {
    let options: any;
    await plugin({ logger: silent } as any).onStart!({
      org: { id: "org" },
      logger: silent,
      auth: { get: () => ({ methodId: "apiKey", credentials: {} }) },
      config: { get: () => "sk_test_x" },
      mcp: {
        startExternal: async (opts: any) => {
          options = opts;
        },
      },
    } as any);
    expect(options.toolRisk).toBe(STRIPE_TOOL_RISK);
  });
});
