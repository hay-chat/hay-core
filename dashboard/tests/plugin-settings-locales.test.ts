import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D20: the plugin settings page, config form and OAuth card read every string
// from integrations.json `pluginSettings`. Both locales carry the same keys, and
// merchant copy never names a server environment variable.
const read = (locale: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "i18n/locales", locale, "integrations.json"), "utf8"),
  ).pluginSettings;

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(strings);
}

describe("plugin settings locales", () => {
  it("en and pt-BR have the same pluginSettings keys", () => {
    expect(keys(read("pt-BR")).sort()).toEqual(keys(read("en")).sort());
  });

  it("names no environment variable", () => {
    for (const locale of ["en", "pt-BR"]) {
      expect(strings(read(locale)).join("\n")).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
    }
  });
});
