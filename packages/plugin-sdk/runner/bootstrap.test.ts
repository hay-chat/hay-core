import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadManifest } from "./bootstrap";

const dirs: string[] = [];

function pluginDir(capabilities: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hay-plugin-manifest-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "test-plugin",
      "hay-plugin": {
        entry: "./dist/index.js",
        displayName: "Test plugin",
        category: "channel",
        capabilities,
      },
    }),
  );
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadManifest capabilities", () => {
  it("accepts every capability the host understands", () => {
    const { manifest } = loadManifest(
      pluginDir([
        "routes",
        "mcp",
        "auth",
        "config",
        "ui",
        "messages",
        "customers",
        "sources",
        "products",
        "cron",
        "email",
        "webchat",
        "disputes",
        "tickets",
      ]),
    );
    expect(manifest.capabilities).toContain("disputes");
  });

  it("rejects an unknown capability by name", () => {
    expect(() => loadManifest(pluginDir(["messages", "telepathy"]))).toThrow(
      /Invalid capability "telepathy"/,
    );
  });

  // The runner's list drifted once: "disputes" reached the manifest type and the
  // server but not this check, so the Shopify worker refused to start in prod.
  it("loads every core plugin manifest", () => {
    const coreDir = join(__dirname, "../../../plugins/core");
    const plugins = readdirSync(coreDir).filter((name) =>
      existsSync(join(coreDir, name, "package.json")),
    );
    expect(plugins.length).toBeGreaterThan(0);
    for (const name of plugins) {
      expect(() => loadManifest(join(coreDir, name)), name).not.toThrow();
    }
  });
});
