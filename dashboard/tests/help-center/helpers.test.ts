import { describe, expect, it } from "vitest";
import {
  DEFAULT_HELP_CENTER_THEME,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  encodeThemeParam,
  isHexColor,
  moved,
  normalizeTheme,
  previewUrl,
  toBase64Url,
  type HelpCenterTheme,
} from "../../utils/help-center";

describe("contrastRatio", () => {
  it("spans 1 (same colour) to 21 (black on white), in either order", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });

  it("matches the published WCAG values around the 4.5:1 threshold", () => {
    // #767676 is the lightest grey that passes AA on white; #777777 just fails.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeLessThan(MIN_TEXT_CONTRAST);
  });

  it("passes the default accent colour and flags a light one", () => {
    expect(contrastRatio(DEFAULT_HELP_CENTER_THEME.accentColor, "#ffffff")).toBeGreaterThan(
      MIN_TEXT_CONTRAST,
    );
    expect(contrastRatio("#ffcc00", "#ffffff")).toBeLessThan(MIN_TEXT_CONTRAST);
  });
});

describe("isHexColor", () => {
  it("accepts only #rrggbb", () => {
    expect(isHexColor("#2747D6")).toBe(true);
    expect(isHexColor("#27d")).toBe(false);
    expect(isHexColor("2747d6")).toBe(false);
    expect(isHexColor("#2747dg")).toBe(false);
  });
});

describe("theme preview encoding", () => {
  const theme: HelpCenterTheme = {
    accentColor: "#ff8800",
    font: "rounded",
    layout: "list",
    heroTitle: "Olá 👋 — como podemos ajudar?",
    heroSubtitle: null,
    showPoweredBy: false,
  };

  it("uses the URL-safe alphabet without padding", () => {
    // Standard base64 of this text is "Pz8/Pj4+" and of "a" is "YQ==".
    expect(toBase64Url("???>>>")).toBe("Pz8_Pj4-");
    expect(toBase64Url("a")).toBe("YQ");
  });

  it("round-trips a theme, including non-ASCII text", () => {
    const encoded = encodeThemeParam(theme);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).toEqual(theme);
  });

  it("builds the preview address, with the draft theme only when given", () => {
    const link = { baseUrl: "https://acme.help.example.com", token: "1700000000.abc-_" };
    expect(previewUrl(link)).toBe("https://acme.help.example.com/?hc_preview=1700000000.abc-_");
    expect(previewUrl(link, theme)).toBe(
      `https://acme.help.example.com/?hc_preview=1700000000.abc-_&hc_theme=${encodeThemeParam(theme)}`,
    );
  });

  it("stores empty hero text as not set", () => {
    expect(
      normalizeTheme({ ...theme, accentColor: "#FF8800", heroTitle: "  ", heroSubtitle: " Hi " }),
    ).toMatchObject({ accentColor: "#ff8800", heroTitle: null, heroSubtitle: "Hi" });
  });
});

describe("moved", () => {
  it("swaps with the neighbour and leaves the ends alone", () => {
    expect(moved(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});
