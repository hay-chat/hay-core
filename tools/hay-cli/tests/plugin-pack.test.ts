import AdmZip from "adm-zip";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PACK_MANIFEST_FILE, parsePackManifest, sha256Hex } from "../../../server/lib/plugin-pack";
import { packPlugin } from "../src/plugin-pack";

let work: string;

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "hay-pack-test-"));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

function write(file: string, content: string) {
  const target = path.join(work, "plugin", file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function pluginWithDependency() {
  write(
    "package.json",
    JSON.stringify({
      name: "hay-plugin-sample",
      version: "2.0.0",
      type: "module",
      dependencies: { "left-pad-lite": "1.0.0" },
      scripts: { postinstall: "node steal.js" },
      "hay-plugin": { entry: "./dist/index.js" },
    }),
  );
  // A dependency that only exists in node_modules: the pack must inline it.
  write(
    "node_modules/left-pad-lite/package.json",
    JSON.stringify({ name: "left-pad-lite", main: "index.js" }),
  );
  write("node_modules/left-pad-lite/index.js", "module.exports = (s) => ' ' + s;");
  write(
    "dist/index.js",
    'import pad from "left-pad-lite"; import "@hay/plugin-sdk"; export default pad("hi");',
  );
  write("i18n/en.json", "{}");
  write(".env", "SECRET=1");
  write("package-lock.json", "{}");
}

const entries = (archive: string) =>
  new Map(new AdmZip(archive).getEntries().map((e) => [e.entryName, e.getData()]));

describe("packPlugin", () => {
  it("inlines dependencies, leaves the SDK external and lists every file", async () => {
    pluginWithDependency();
    const result = await packPlugin(path.join(work, "plugin"), path.join(work, "out.zip"));
    const files = entries(result.archive);

    const bundle = files.get("dist/index.js")!.toString();
    expect(bundle).toContain('" " + s');
    expect(bundle).toContain('"@hay/plugin-sdk"');
    expect(bundle).not.toContain('from "left-pad-lite"');
    expect(bundle).not.toContain(work);

    const manifest = parsePackManifest(files.get(PACK_MANIFEST_FILE)!.toString());
    expect(Object.keys(manifest.files).sort()).toEqual([
      "dist/index.js",
      "i18n/en.json",
      "package.json",
    ]);
    for (const [name, info] of Object.entries(manifest.files)) {
      expect(sha256Hex(files.get(name)!)).toBe(info.sha256);
    }
    expect(result.sha256).toBe(sha256Hex(readFileSync(result.archive)));
  });

  it("drops install fields, secrets and lockfiles from the archive", async () => {
    pluginWithDependency();
    const result = await packPlugin(path.join(work, "plugin"), path.join(work, "out.zip"));
    const files = entries(result.archive);
    const pkg = JSON.parse(files.get("package.json")!.toString());
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.scripts).toBeUndefined();
    expect(pkg["hay-plugin"].entry).toBe("./dist/index.js");
    expect(files.has(".env")).toBe(false);
    expect(files.has("package-lock.json")).toBe(false);
    expect([...files.keys()].some((name) => name.startsWith("node_modules/"))).toBe(false);
  });

  it("bundles the main file of a bundled mcp/ server", async () => {
    pluginWithDependency();
    write("mcp/package.json", JSON.stringify({ name: "mcp", type: "module", main: "server.js" }));
    write("mcp/server.js", 'import pad from "left-pad-lite"; console.log(pad("x"));');
    const result = await packPlugin(path.join(work, "plugin"), path.join(work, "out.zip"));
    expect(result.bundled).toEqual(["dist/index.js", "mcp/server.js"]);
    expect(entries(result.archive).get("mcp/server.js")!.toString()).toContain('" " + s');
  });

  it("refuses a plugin that has not been built", async () => {
    pluginWithDependency();
    rmSync(path.join(work, "plugin", "dist"), { recursive: true });
    await expect(packPlugin(path.join(work, "plugin"), path.join(work, "out.zip"))).rejects.toThrow(
      /Build the plugin first/,
    );
  });

  it("refuses a dependency that cannot be bundled", async () => {
    pluginWithDependency();
    write("dist/index.js", 'import "not-installed-anywhere"; export default 1;');
    await expect(packPlugin(path.join(work, "plugin"), path.join(work, "out.zip"))).rejects.toThrow(
      /Could not bundle/,
    );
  });

  it("only packs what package.json files lists", async () => {
    pluginWithDependency();
    const pkgPath = path.join(work, "plugin", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    writeFileSync(pkgPath, JSON.stringify({ ...pkg, files: ["dist"] }));
    const result = await packPlugin(path.join(work, "plugin"), path.join(work, "out.zip"));
    expect(Object.keys(result.manifest.files).sort()).toEqual(["dist/index.js", "package.json"]);
  });
});
