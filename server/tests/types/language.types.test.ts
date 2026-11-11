import { languageName, normalizeLanguage, shouldAdoptLanguage } from "../../types/language.types";

describe("normalizeLanguage", () => {
  it.each([
    ["sv-SE", "sv"],
    ["en", "en"],
    ["EN-us", "en"],
    ["pt-BR", "pt"],
    ["pt", "pt"],
    ["pt-PT", "pt-PT"],
    ["pt_PT", "pt-PT"],
    ["zh-CN", "zh"],
    ["zh-Hans", "zh"],
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-Hant-CN", "zh-Hant"],
    ["iw", "he"],
    ["fil", "tl"],
  ])("maps %s to %s", (tag, code) => {
    expect(normalizeLanguage(tag)).toBe(code);
  });

  it.each([null, undefined, "", "  ", "not a tag!", "xx", "tlh"])("returns null for %p", (tag) => {
    expect(normalizeLanguage(tag)).toBeNull();
  });
});

describe("languageName", () => {
  it("names a code in English by default", () => {
    expect(languageName("sv")).toBe("Swedish");
    expect(languageName("pt-PT")).toBe("European Portuguese");
  });

  it("names pt as Brazilian Portuguese, since pt means Brazilian in Hay", () => {
    expect(languageName("pt")).toBe("Brazilian Portuguese");
  });

  it("writes the name in the display locale", () => {
    expect(languageName("nl", "nl")).toBe("Nederlands");
    expect(languageName("de", "nl")).toBe("Duits");
  });

  it("falls back to English for an empty code", () => {
    expect(languageName(null)).toBe("English");
    expect(languageName("")).toBe("English");
  });
});

describe("shouldAdoptLanguage", () => {
  const long = "Hej, jag har inte fått min beställning ännu";

  it("adopts a different language from a long enough message", () => {
    expect(shouldAdoptLanguage(long, "sv", "en")).toBe(true);
    expect(shouldAdoptLanguage(long, "sv", null)).toBe(true);
  });

  it("ignores short replies", () => {
    expect(shouldAdoptLanguage("merci", "fr", "en")).toBe(false);
    expect(shouldAdoptLanguage("ok 👍", "it", "en")).toBe(false);
  });

  it("counts CJK characters as more than one letter", () => {
    expect(shouldAdoptLanguage("我的订单还没到", "zh", "en")).toBe(true);
    expect(shouldAdoptLanguage("谢谢", "zh", "en")).toBe(false);
  });

  it("does nothing when the language is unchanged", () => {
    expect(shouldAdoptLanguage(long, "sv", "sv")).toBe(false);
  });

  it("ignores unknown or missing codes", () => {
    expect(shouldAdoptLanguage(long, "xx", "en")).toBe(false);
    expect(shouldAdoptLanguage(long, null, "en")).toBe(false);
    expect(shouldAdoptLanguage(long, "sv-SE", "en")).toBe(false);
  });
});
