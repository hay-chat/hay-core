import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D7-11..13: the Tests pages read every string from tests.json. Both locales
// must have the same keys, and the report never shows a headline percentage.
const read = (locale: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "i18n/locales", locale, "tests.json"), "utf8"));

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

describe("tests locales", () => {
  it("en and pt-BR have the same keys", () => {
    expect(keys(read("pt-BR")).sort()).toEqual(keys(read("en")).sort());
  });

  it("shows no percentages in the replay report", () => {
    for (const locale of ["en", "pt-BR"]) {
      expect(strings(read(locale).tests.report).join("\n")).not.toContain("%");
    }
  });
});
