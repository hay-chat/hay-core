import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/**
 * Every email locale file has exactly the keys of en.json, with the same
 * {{ placeholders }} and HTML tags in each string: a missing key silently falls
 * back to English, a lost placeholder or tag breaks the email.
 */
const dir = path.join(__dirname, "../../i18n/emails");
type Locale = Record<string, Record<string, string>>;
const read = (file: string): Locale => JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

const placeholders = (text: string) => (text.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).sort();
const tags = (text: string) => (text.match(/<\/?[a-z]+[^>]*>/g) ?? []).sort();

const english = read("en.json");
const others = fs.readdirSync(dir).filter((file) => file.endsWith(".json") && file !== "en.json");

describe.each(others)("%s", (file) => {
  const locale = read(file);

  it("has every key of en.json and no other", () => {
    expect(Object.keys(locale).sort()).toEqual(Object.keys(english).sort());
    for (const section of Object.keys(english)) {
      expect([section, Object.keys(locale[section] ?? {}).sort()]).toEqual([
        section,
        Object.keys(english[section]).sort(),
      ]);
    }
  });

  it("keeps every placeholder and HTML tag", () => {
    for (const [section, entries] of Object.entries(english)) {
      for (const [key, text] of Object.entries(entries)) {
        const translated = locale[section]?.[key] ?? "";
        expect([`${section}.${key}`, placeholders(translated)]).toEqual([
          `${section}.${key}`,
          placeholders(text),
        ]);
        expect([`${section}.${key}`, tags(translated)]).toEqual([`${section}.${key}`, tags(text)]);
      }
    }
  });
});

it("ships Dutch email copy", () => {
  expect(others).toContain("nl.json");
});
