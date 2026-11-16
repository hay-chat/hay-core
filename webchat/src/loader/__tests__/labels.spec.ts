import { describe, it, expect } from "vitest";
import { launcherLabels } from "../labels";

// The loader keeps its two strings per locale as literals (see labels.ts); this
// fails when a locale file changes and the loader copy does not.
const localeModules = import.meta.glob<{ default: Record<string, string> }>(
  "../../i18n/locales/*.ts",
  { eager: true },
);

describe("launcherLabels", () => {
  it("covers every locale file", () => {
    const files = Object.keys(localeModules).map((p) => p.split("/").pop()!.replace(".ts", ""));
    expect(Object.keys(launcherLabels).sort()).toEqual(files.sort());
  });

  it.each(Object.entries(localeModules))("matches %s", (path, mod) => {
    const locale = path.split("/").pop()!.replace(".ts", "") as keyof typeof launcherLabels;
    expect(launcherLabels[locale]).toEqual({
      open: mod.default["chat.open"],
      dismissTeaser: mod.default["chat.dismissTeaser"],
    });
  });
});
