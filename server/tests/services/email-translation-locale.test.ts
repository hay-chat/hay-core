import { describe, it, expect } from "@jest/globals";
import { resolveEmailLocale } from "@server/services/email-translation.service";

/** Emails exist in English, Brazilian Portuguese and Dutch; every language maps to one of them. */
describe("resolveEmailLocale", () => {
  const available = ["en", "pt-BR", "nl"];

  it.each([
    ["en", "en"],
    ["pt-BR", "pt-BR"],
    ["pt", "pt-BR"],
    ["pt-PT", "pt-BR"],
    ["nl", "nl"],
    ["nl-BE", "nl"],
    ["de", "en"],
    ["zh-Hant", "en"],
    ["", "en"],
    [null, "en"],
    [undefined, "en"],
  ])("sends %p in %p", (locale, expected) => {
    expect(resolveEmailLocale(locale, available)).toBe(expected);
  });
});
