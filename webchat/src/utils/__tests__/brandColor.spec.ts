import { describe, it, expect } from "vitest";
import {
  accentColor,
  brandColors,
  brandTokens,
  contrastRatio,
  launcherIconColor,
  normalizeHex,
  NEAR_BLACK,
  SURFACE,
  WHITE,
} from "../brandColor";

/**
 * The brand-colour rule (widget spec): whatever colour the merchant picks, text
 * on it and brand-coloured text on the window reach WCAG AA (4.5:1).
 */

const EXAMPLES = ["#3b82f6", "#10b981", "#f59e0b", "#7c3aed", "#8b5cf6", "#000000"];
// Edge cases: white, mid grey, pure primaries, a pale pastel, the default.
const EDGES = ["#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff", "#fde68a", "#001df5"];

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("normalizeHex", () => {
  it("accepts 3 and 6 digit hex, with or without #, in any case", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("3B82F6")).toBe("#3b82f6");
    expect(normalizeHex(" #10b981 ")).toBe("#10b981");
  });

  it("rejects anything else", () => {
    for (const value of ["", "red", "#12345", "#gggggg", "rgb(0,0,0)", null, undefined]) {
      expect(normalizeHex(value)).toBeNull();
    }
  });
});

describe("brandColors", () => {
  it.each([...EXAMPLES, ...EDGES])("%s: text on the brand reaches 4.5:1", (input) => {
    const { brand, onBrand } = brandColors(input);
    expect(contrastRatio(brand, onBrand)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a colour white text already reads on (rule 1)", () => {
    expect(brandColors("#7c3aed")).toEqual({ brand: "#7c3aed", onBrand: WHITE });
    expect(brandColors("#000000")).toEqual({ brand: "#000000", onBrand: WHITE });
    expect(brandColors("#001df5")).toEqual({ brand: "#001df5", onBrand: WHITE });
  });

  it("keeps a light colour with near-black text when that reaches 7:1 (rule 2)", () => {
    expect(brandColors("#f59e0b")).toEqual({ brand: "#f59e0b", onBrand: NEAR_BLACK });
    expect(brandColors("#ffffff")).toEqual({ brand: "#ffffff", onBrand: NEAR_BLACK });
    expect(contrastRatio("#f59e0b", NEAR_BLACK)).toBeGreaterThanOrEqual(7);
  });

  it("darkens a mid colour until white text reaches 4.5:1 (rule 3)", () => {
    for (const input of ["#3b82f6", "#10b981", "#8b5cf6"]) {
      const { brand, onBrand } = brandColors(input);
      expect(onBrand).toBe(WHITE);
      expect(brand).not.toBe(input);
      expect(contrastRatio(brand, WHITE)).toBeGreaterThanOrEqual(4.5);
      // Only as dark as needed: one 4% step less would not be enough.
      expect(contrastRatio(brand, WHITE)).toBeLessThan(5.2);
    }
  });

  it("falls back to the default colour for an invalid value", () => {
    expect(brandColors("not a colour")).toEqual(brandColors("#001df5"));
  });
});

describe("accentColor", () => {
  it.each([...EXAMPLES, ...EDGES])("%s: the accent reads on both surfaces", (input) => {
    expect(contrastRatio(accentColor(input, "light"), SURFACE.light)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accentColor(input, "dark"), SURFACE.dark)).toBeGreaterThanOrEqual(4.5);
  });

  it("is the brand itself when it already reads on the surface", () => {
    expect(accentColor("#7c3aed", "light")).toBe("#7c3aed");
  });

  it("lightens a dark brand on the dark surface", () => {
    const accent = accentColor("#000000", "dark");
    expect(accent).not.toBe("#000000");
    expect(contrastRatio(accent, SURFACE.dark)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("launcherIconColor", () => {
  it("is white when white reaches 3:1 on the exact merchant colour, else near-black", () => {
    expect(launcherIconColor("#3b82f6")).toBe(WHITE); // 3.68:1
    expect(launcherIconColor("#000000")).toBe(WHITE);
    expect(launcherIconColor("#f59e0b")).toBe(NEAR_BLACK); // 2.15:1
    expect(launcherIconColor("#ffffff")).toBe(NEAR_BLACK);
  });

  it.each([...EXAMPLES, ...EDGES])("%s: the icon reaches 3:1", (input) => {
    expect(contrastRatio(input, launcherIconColor(input))).toBeGreaterThanOrEqual(3);
  });
});

describe("brandTokens", () => {
  it("keeps the exact merchant colour for the launcher only", () => {
    const tokens = brandTokens("#3b82f6");
    expect(tokens["--hay-launcher"]).toBe("#3b82f6");
    expect(tokens["--hay-brand"]).not.toBe("#3b82f6");
    expect(tokens["--hay-on-brand"]).toBe(WHITE);
  });

  it("uses the default colour when none is set", () => {
    expect(brandTokens(null)["--hay-launcher"]).toBe("#001df5");
  });
});
