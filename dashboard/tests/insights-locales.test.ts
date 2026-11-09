import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";

const read = (locale: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "i18n/locales", locale, "insights.json"), "utf8"));

describe("insights list count", () => {
  it.each(["en", "pt-BR"])("pluralizes in %s", (locale) => {
    const i18n = createI18n({
      legacy: false,
      locale,
      messages: { [locale]: read(locale) },
    });
    const t = i18n.global.t;
    const count = (n: number) => t("insights.page.list.count", { count: n }, n);
    expect(count(1)).toBe("1 insight");
    expect(count(2)).toBe("2 insights");
  });
});
