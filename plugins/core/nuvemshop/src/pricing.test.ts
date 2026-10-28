import { describe, it, expect } from "vitest";
import { variantPricing } from "./pricing.js";

describe("variantPricing", () => {
  it("uses a real promotion as the selling price, regular as compare-at", () => {
    expect(variantPricing("100.00", "80.00")).toEqual({ price: 80, compareAtPrice: 100 });
  });

  it("ignores a 0.00 promotional price", () => {
    expect(variantPricing("100.00", "0.00")).toEqual({ price: 100, compareAtPrice: undefined });
  });

  it("ignores a promotional price that is not below the regular price", () => {
    expect(variantPricing("100.00", "100.00")).toEqual({ price: 100, compareAtPrice: undefined });
    expect(variantPricing("100.00", "120.00")).toEqual({ price: 100, compareAtPrice: undefined });
  });

  it("handles missing prices", () => {
    expect(variantPricing("50.00", null)).toEqual({ price: 50, compareAtPrice: undefined });
    expect(variantPricing(null, null)).toEqual({ price: undefined, compareAtPrice: undefined });
  });
});
