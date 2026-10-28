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

  it("never claims Require Approval holds actions", () => {
    // D7-13: approval holds replies only; D4 action approvals are separate.
    const claims = [/approval holds? (the )?actions/i, /segura (também )?(as )?ações/i];
    for (const locale of ["en", "pt-BR"]) {
      const text = strings(read(locale)).join("\n");
      for (const claim of claims) expect(text).not.toMatch(claim);
      expect(strings(read(locale).tests.readiness).join("\n")).not.toContain("%");
    }
  });
});
