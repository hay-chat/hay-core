import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D2-5: the evidence pack page reads every string from evidence.json, so every
// locale must have the same keys, and no copy may promise a dispute outcome.
const read = (locale: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "i18n/locales", locale, "evidence.json"), "utf8"));

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

describe("evidence locales", () => {
  it.each(["pt-BR", "nl"])("en and %s have the same keys", (locale) => {
    expect(keys(read(locale)).sort()).toEqual(keys(read("en")).sort());
  });

  it("never promises a won dispute or provider acceptance", () => {
    const all = ["en", "pt-BR", "nl"]
      .flatMap((locale) => strings(read(locale)))
      .join("\n")
      .toLowerCase();
    for (const phrase of [
      "win your",
      "guaranteed",
      "will be accepted",
      "ganhar a disputa",
      "garantido",
      "gegarandeerd",
      "wordt geaccepteerd",
    ]) {
      expect(all).not.toContain(phrase);
    }
  });
});
