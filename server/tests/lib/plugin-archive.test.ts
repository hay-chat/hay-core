import { describe, it, expect } from "@jest/globals";
import AdmZip from "adm-zip";
import { validatePluginZip } from "@server/lib/plugin-archive";

const packageJson = (name = "my-plugin") =>
  Buffer.from(JSON.stringify({ name, version: "1.2.3", "hay-plugin": { entry: "dist/index.js" } }));

function zipOf(files: Record<string, Buffer>, symlinks: Record<string, string> = {}): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, content);
  }
  for (const [name, target] of Object.entries(symlinks)) {
    // Unix mode S_IFLNK | 0777 in the high 16 bits of the external attributes
    // (as `zip -y` writes it; adm-zip's addFile would force a regular file)
    zip.addFile(name, Buffer.from(target)).header.attr = (0o120777 << 16) >>> 0;
  }
  return zip.toBuffer();
}

describe("validatePluginZip", () => {
  it("accepts a plugin with a root package.json", () => {
    const result = validatePluginZip(
      zipOf({ "package.json": packageJson(), "dist/index.js": Buffer.from("") }),
    );
    expect(result.pluginId).toBe("my-plugin");
    expect(result.manifest.version).toBe("1.2.3");
  });

  it("rejects symbolic link entries", () => {
    expect(() =>
      validatePluginZip(zipOf({ "package.json": packageJson() }, { "dist/link": "/etc/passwd" })),
    ).toThrow(/Symbolic links are not allowed/);
  });

  it("only accepts package.json at the archive root", () => {
    expect(() => validatePluginZip(zipOf({ "nested/package.json": packageJson() }))).toThrow(
      /package.json not found in ZIP root/,
    );
  });

  it("does not pick a nested package.json over a missing root one", () => {
    const zip = zipOf({
      "node_modules/other/package.json": packageJson("other"),
      "README.md": Buffer.from("x"),
    });
    expect(() => validatePluginZip(zip)).toThrow(/package.json not found in ZIP root/);
  });

  it("rejects an invalid package name", () => {
    expect(() => validatePluginZip(zipOf({ "package.json": packageJson("../escape") }))).toThrow(
      /valid npm package name/,
    );
  });

  it("rejects core-only manifest fields", () => {
    const pkg = Buffer.from(
      JSON.stringify({ name: "p", "hay-plugin": { entry: "x.js", trpcRouter: "router.cjs" } }),
    );
    expect(() => validatePluginZip(zipOf({ "package.json": pkg }))).toThrow(
      /only supported for core/,
    );
  });

  it("rejects data that is not a ZIP", () => {
    expect(() => validatePluginZip(Buffer.from("not a zip"))).toThrow();
  });
});
