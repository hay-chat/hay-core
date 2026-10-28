import { describe, it, expect } from "vitest";
import {
  COUPON_DEFAULTS,
  readCouponPolicy,
  enforceCouponCap,
  couponExpiry,
  generateCouponCode,
} from "./index.cjs";

const policy = { enabled: true, maxPercent: 10, maxAmount: 20, maxDays: 30 };
const codeOf = (fn: () => void) => {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code;
  }
};

describe("readCouponPolicy", () => {
  it("defaults to enabled, 10%, fixed off, 30 days", () => {
    expect(readCouponPolicy("X_", {})).toEqual({ enabled: true, ...COUPON_DEFAULTS });
  });

  it("reads the merchant's settings and clamps bad values", () => {
    expect(
      readCouponPolicy("X_", {
        X_COUPONS_ENABLED: "false",
        X_COUPON_MAX_PERCENT: "250",
        X_COUPON_MAX_AMOUNT: "-5",
        X_COUPON_MAX_DAYS: "9999",
      }),
    ).toEqual({ enabled: false, maxPercent: 100, maxAmount: 0, maxDays: 365 });
  });
});

describe("enforceCouponCap", () => {
  it("allows coupons within the cap", () => {
    expect(codeOf(() => enforceCouponCap({ type: "percentage", value: 10 }, policy))).toBeNull();
    expect(codeOf(() => enforceCouponCap({ type: "absolute", value: 20 }, policy))).toBeNull();
  });

  it("asks for approval above the cap, with the amount for fixed coupons", () => {
    expect(codeOf(() => enforceCouponCap({ type: "percentage", value: 15 }, policy))).toBe(
      "NEEDS_APPROVAL",
    );
    try {
      enforceCouponCap({ type: "absolute", value: 50 }, policy);
    } catch (err) {
      expect(err).toMatchObject({
        code: "NEEDS_APPROVAL",
        details: { amount: 50, cap: 20, requested: 50 },
      });
      expect((err as Error).message).not.toMatch(/held|waiting|requested approval/i);
    }
  });

  it("lets an approved call above the cap through, but never over 100%", () => {
    expect(
      codeOf(() => enforceCouponCap({ type: "percentage", value: 30 }, policy, { approved: true })),
    ).toBeNull();
    expect(
      codeOf(() =>
        enforceCouponCap({ type: "percentage", value: 120 }, policy, { approved: true }),
      ),
    ).toBe("BAD_INPUT");
  });

  it("refuses when coupons or the coupon type are turned off", () => {
    expect(
      codeOf(() =>
        enforceCouponCap({ type: "percentage", value: 5 }, { ...policy, enabled: false }),
      ),
    ).toBe("PRECONDITION");
    expect(
      codeOf(() => enforceCouponCap({ type: "absolute", value: 5 }, { ...policy, maxAmount: 0 })),
    ).toBe("PRECONDITION");
  });

  it("refuses non-positive values", () => {
    expect(codeOf(() => enforceCouponCap({ type: "absolute", value: 0 }, policy))).toBe(
      "BAD_INPUT",
    );
  });
});

describe("couponExpiry and codes", () => {
  it("clamps validity to the merchant's maximum", () => {
    const now = new Date("2026-10-28T00:00:00Z");
    expect(couponExpiry(policy, 90, now).toISOString()).toBe("2026-11-27T00:00:00.000Z");
    expect(couponExpiry(policy, 3, now).toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(couponExpiry(policy, undefined, now).toISOString()).toBe("2026-11-27T00:00:00.000Z");
  });

  it("generates unguessable HAY codes", () => {
    const a = generateCouponCode();
    expect(a).toMatch(/^HAY[A-Z2-9]{8}$/);
    expect(generateCouponCode()).not.toBe(a);
  });
});
