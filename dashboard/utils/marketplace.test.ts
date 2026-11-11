import { describe, expect, it } from "vitest";
import { capabilityTags, matchesSearch, sectionOf } from "./marketplace";

describe("sectionOf", () => {
  it("uses the category the plugin declares", () => {
    expect(sectionOf({ marketplaceCategory: "commerce" })).toBe("commerce");
  });

  it("lists plugins without a known category under other", () => {
    expect(sectionOf({ marketplaceCategory: null })).toBe("other");
    expect(sectionOf({})).toBe("other");
    expect(sectionOf({ marketplaceCategory: "made-up" })).toBe("other");
  });
});

describe("capabilityTags", () => {
  it("derives tags from type and capabilities, in display order", () => {
    expect(
      capabilityTags({
        type: ["mcp-connector", "products"],
        capabilities: ["mcp", "auth", "cron", "products", "disputes", "privacy"],
      }),
    ).toEqual(["tools", "catalog", "disputes"]);
  });

  it("puts the knowledge source before agent tools", () => {
    expect(capabilityTags({ type: ["document_importer"], capabilities: ["mcp", "auth"] })).toEqual([
      "knowledge",
      "tools",
    ]);
  });

  it("describes a channel", () => {
    expect(capabilityTags({ type: ["channel"], capabilities: ["messages", "customers"] })).toEqual([
      "channel",
    ]);
  });

  it("ignores plumbing capabilities and legacy object manifests", () => {
    expect(capabilityTags({ type: [], capabilities: ["auth", "config", "cron"] })).toEqual([]);
    expect(capabilityTags({ type: [], capabilities: { mcp: {} } })).toEqual([]);
    expect(capabilityTags({})).toEqual([]);
  });
});

describe("matchesSearch", () => {
  const texts = [
    "Stripe",
    "Look up payments and keep on top of disputes.",
    "Payments and shipping",
  ];

  it("matches name, description and category, ignoring case", () => {
    expect(matchesSearch(texts, "stripe")).toBe(true);
    expect(matchesSearch(texts, "DISPUTES")).toBe(true);
    expect(matchesSearch(texts, "shipping")).toBe(true);
  });

  it("needs every word to appear", () => {
    expect(matchesSearch(texts, "stripe disputes")).toBe(true);
    expect(matchesSearch(texts, "stripe refunds")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchesSearch(texts, "   ")).toBe(true);
  });
});
