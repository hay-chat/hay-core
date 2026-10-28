import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { baseCompile } from "@intlify/message-compiler";
import { describe, expect, it } from "vitest";

// One message the compiler rejects (a bare "@" in an email placeholder, say)
// fails its whole file in the browser, and every key on the page shows raw.
const LOCALES = join(__dirname, "..", "i18n/locales");

function messages(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => messages(child, `${path}.${key}`));
}

describe("locale messages", () => {
  it("every message compiles (escape @ { } | as {'@'})", () => {
    const failures: string[] = [];
    for (const locale of readdirSync(LOCALES)) {
      for (const file of readdirSync(join(LOCALES, locale))) {
        const json = JSON.parse(readFileSync(join(LOCALES, locale, file), "utf8"));
        for (const [path, message] of messages(json, `${locale}/${file}`)) {
          baseCompile(message, {
            onError: (error) => failures.push(`${path}: ${error.message}`),
          });
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
