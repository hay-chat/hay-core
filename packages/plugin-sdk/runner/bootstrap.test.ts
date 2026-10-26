import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
      ]),
    );
    expect(manifest.capabilities).toContain("email");
  });

  it("rejects an unknown capability by name", () => {
    expect(() => loadManifest(pluginDir(["messages", "telepathy"]))).toThrow(
      /Invalid capability "telepathy"/,
    );
  });
});
