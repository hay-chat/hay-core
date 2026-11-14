/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import enUs from "../locales/en-us";

const modules = import.meta.glob<{ default: Record<string, string> }>("../locales/*.ts", {
  eager: true,
});
const locales = Object.entries(modules).map(([path, mod]) => [
  path.replace(/^.*\/(.+)\.ts$/, "$1"),
  mod.default,
]) as [string, Record<string, string>][];

describe("widget locales", () => {
  it("ships all 13 locales", () => {
    expect(locales).toHaveLength(13);
  });

  it.each(locales)("%s defines every key en-us defines", (_name, messages) => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(enUs).sort());
  });

  it.each(locales.filter(([name]) => name !== "en-us"))(
    "%s translates the user-facing defaults instead of reusing English",
    (_name, messages) => {
      for (const key of [
        "widget.defaultSubtitle",
        "error.sendFailed",
        "error.messageTooLong",
        "chat.aiDisclosure",
        "csat.defaultQuestion",
        "chat.startNew",
      ]) {
        if (key in enUs) expect(messages[key]).not.toBe((enUs as Record<string, string>)[key]);
      }
    },
  );
});

describe("loadTranslations (one locale chunk per visitor)", () => {
  it("loads the configured locale", async () => {
    const { loadTranslations } = await import("../index");
    expect((await loadTranslations("pt-br"))["chat.open"]).toBe("Abrir chat");
    expect((await loadTranslations("pt-PT"))["input.placeholder"]).toBe(
      (await import("../locales/pt-pt")).default["input.placeholder"],
    );
  });

  it("falls back to English for an unknown locale", async () => {
    const { loadTranslations } = await import("../index");
    const original = navigator.language;
    Object.defineProperty(navigator, "language", { value: "xx-XX", configurable: true });
    expect(await loadTranslations("xx")).toBe(enUs);
    Object.defineProperty(navigator, "language", { value: original, configurable: true });
  });
});
