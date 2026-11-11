import fs, { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const upsertPlugin = jest.fn(async (input: Record<string, unknown>) => input);

jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { upsertPlugin },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("../../services/plugin-runner.service", () => ({
  getPluginRunnerService: () => ({}),
}));

import { pluginManagerService, readHomepage } from "../../services/plugin-manager.service";
import { MARKETPLACE_CATEGORIES } from "@server/types/plugin.types";

async function register(pkg: Record<string, unknown>, hayPlugin: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), "hay-plugin-"));
  try {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "hay-test-shop", version: "1.0.0", ...pkg, "hay-plugin": hayPlugin }),
    );
    await pluginManagerService.registerPlugin(dir, "core", null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return upsertPlugin.mock.calls[upsertPlugin.mock.calls.length - 1][0] as {
    manifest: { marketplaceCategory?: string; homepage?: string };
  };
}

describe("manifest marketplace fields", () => {
  beforeEach(() => upsertPlugin.mockClear());

  it("keeps a known marketplace category and an https homepage", async () => {
    const saved = await register(
      { homepage: "https://hay.chat/docs/user-guide/integrations/shop/" },
      { displayName: "Shop", category: "integration", marketplaceCategory: "commerce" },
    );
    expect(saved.manifest.marketplaceCategory).toBe("commerce");
    expect(saved.manifest.homepage).toBe("https://hay.chat/docs/user-guide/integrations/shop/");
  });

  it("drops an unknown category instead of trusting it", async () => {
    const saved = await register(
      {},
      { displayName: "Shop", category: "integration", marketplaceCategory: "featured" },
    );
    expect(saved.manifest.marketplaceCategory).toBeUndefined();
    expect(saved.manifest.homepage).toBeUndefined();
  });

  it("only accepts https homepages", () => {
    expect(readHomepage("https://example.com/guide")).toBe("https://example.com/guide");
    expect(readHomepage("http://example.com/guide")).toBeUndefined();
    expect(readHomepage("javascript:alert(1)")).toBeUndefined();
    expect(readHomepage("not a url")).toBeUndefined();
    expect(readHomepage(42)).toBeUndefined();
  });
});

describe("core plugins in the marketplace", () => {
  const CORE = path.resolve(__dirname, "../../../plugins/core");
  const plugins = fs
    .readdirSync(CORE)
    .filter((dir) => fs.existsSync(path.join(CORE, dir, "package.json")));

  it.each(plugins)("%s declares a marketplace category", (dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(CORE, dir, "package.json"), "utf8"));
    expect(MARKETPLACE_CATEGORIES).toContain(pkg["hay-plugin"].marketplaceCategory);
  });

  it.each(plugins)("%s has a card summary in every locale it ships", (dir) => {
    const i18nDir = path.join(CORE, dir, "i18n");
    for (const file of fs.readdirSync(i18nDir)) {
      const locale = JSON.parse(fs.readFileSync(path.join(i18nDir, file), "utf8"));
      expect(typeof locale.summary).toBe("string");
      expect(locale.summary.length).toBeLessThanOrEqual(110);
    }
  });
});
