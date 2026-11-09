import { describe, it, expect } from "@jest/globals";
import AdmZip from "adm-zip";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { extractPluginZip, validatePluginZip } from "@server/lib/plugin-archive";

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

  it("limits the package name so its storage folder fits", () => {
    const fits = `@${"a".repeat(40)}/${"b".repeat(46)}`;
    expect(validatePluginZip(zipOf({ "package.json": packageJson(fits) })).pluginId).toBe(fits);
    expect(() => validatePluginZip(zipOf({ "package.json": packageJson(`${fits}c`) }))).toThrow(
      "at most 88",
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

describe("extractPluginZip", () => {
  const withDestination = async (run: (dest: string) => Promise<void>) => {
    const parent = mkdtempSync(path.join(tmpdir(), "plugin-archive-"));
    try {
      await run(path.join(parent, "plugin"));
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  };

  it("writes every file, stored or deflated, including empty ones", async () => {
    await withDestination(async (dest) => {
      await extractPluginZip(
        zipOf({
          "package.json": packageJson(),
          "dist/index.js": Buffer.from("x".repeat(5000)),
          "dist/empty.js": Buffer.from(""),
        }),
        dest,
      );

      expect(readFileSync(path.join(dest, "dist/index.js"), "utf8")).toBe("x".repeat(5000));
      expect(readFileSync(path.join(dest, "dist/empty.js"), "utf8")).toBe("");
    });
  });

  it("stops at the byte cap and removes the partial extraction", async () => {
    const archive = zipOf({
      "package.json": packageJson(),
      "big.bin": Buffer.alloc(64 * 1024),
    });

    await withDestination(async (dest) => {
      await expect(extractPluginZip(archive, dest, 1024)).rejects.toThrow(
        /maximum uncompressed size/,
      );
      expect(existsSync(dest)).toBe(false);
    });
  });
});
