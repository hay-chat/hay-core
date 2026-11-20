import { describe, it, expect } from "@jest/globals";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  PACK_MANIFEST_FILE,
  PackError,
  assertSafePackPath,
  comparePackFiles,
  packListsFile,
  copyPackedFiles,
  parsePackManifest,
  sha256Hex,
  verifyPackedTree,
} from "@server/lib/plugin-pack";

function tree(files: Record<string, string>, withManifest = true): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-pack-"));
  const listed: Record<string, { sha256: string; size: number }> = {};
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
    listed[name] = { sha256: sha256Hex(content), size: Buffer.byteLength(content) };
  }
  if (withManifest) {
    writeFileSync(
      path.join(dir, PACK_MANIFEST_FILE),
      JSON.stringify({ format: 1, name: "p", version: "1.0.0", files: listed }),
    );
  }
  return dir;
}

describe("assertSafePackPath", () => {
  it.each(["package.json", "dist/index.js", "node_modules/a/b.js", "i18n/pt-BR.json"])(
    "accepts %s",
    (name) => expect(() => assertSafePackPath(name)).not.toThrow(),
  );

  it.each([
    "",
    "/abs",
    "../up",
    "a/../b",
    "a//b",
    "./a",
    "a/",
    "a\\b",
    "a\u0000b",
    "C:/x",
    "x".repeat(600),
    "build/native.node",
    "build/NATIVE.NODE",
  ])("rejects %j", (name) => expect(() => assertSafePackPath(name)).toThrow(PackError));
});

describe("parsePackManifest", () => {
  const manifest = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ format: 1, name: "p", version: "1", files: {}, ...extra });

  it("rejects text that is not a manifest", () => {
    expect(() => parsePackManifest("nope")).toThrow(/not valid JSON/);
    expect(() => parsePackManifest("[]")).toThrow(/JSON object/);
    expect(() => parsePackManifest(manifest({ files: [] }))).toThrow(/files list/);
  });

  it.each([
    [{ sha256: "xyz", size: 1 }],
    [{ sha256: "0".repeat(64), size: -1 }],
    [{ sha256: "0".repeat(64), size: 1.5 }],
    ["text"],
  ])("rejects the checksum entry %j", (info) => {
    expect(() => parsePackManifest(manifest({ files: { "a.js": info } }))).toThrow(
      /Invalid checksum entry/,
    );
  });

  it("rejects a manifest that lists itself or a file twice", () => {
    const entry = { sha256: "0".repeat(64), size: 1 };
    expect(() => parsePackManifest(manifest({ files: { [PACK_MANIFEST_FILE]: entry } }))).toThrow(
      /cannot list itself/,
    );
    expect(() => parsePackManifest(manifest({ files: { "a.js": entry, "A.js": entry } }))).toThrow(
      /twice/,
    );
  });
});

describe("verifyPackedTree", () => {
  it("accepts a tree that matches its manifest", async () => {
    const dir = tree({ "package.json": "{}", "dist/a.js": "a" });
    try {
      await expect(verifyPackedTree(dir)).resolves.toMatchObject({ name: "p" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explains how to pack a plugin that has no manifest", async () => {
    const dir = tree({ "package.json": "{}" }, false);
    try {
      await expect(verifyPackedTree(dir)).rejects.toThrow(/hay plugin pack/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a symbolic link, even to a file inside the plugin", async () => {
    const dir = tree({ "package.json": "{}", "dist/a.js": "a" });
    try {
      symlinkSync(path.join(dir, "dist/a.js"), path.join(dir, "dist/b.js"));
      await expect(verifyPackedTree(dir)).rejects.toThrow(/regular files/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("copyPackedFiles", () => {
  it("copies only the listed files and checks each one", async () => {
    const src = tree({ "package.json": "{}", "dist/a.js": "a" });
    writeFileSync(path.join(src, "README.md"), "not in the pack");
    const parent = mkdtempSync(path.join(tmpdir(), "plugin-pack-dest-"));
    const dest = path.join(parent, "out");
    try {
      await copyPackedFiles(src, dest);
      expect(readFileSync(path.join(dest, "dist/a.js"), "utf8")).toBe("a");
      expect(existsSync(path.join(dest, "README.md"))).toBe(false);
      await expect(verifyPackedTree(dest)).resolves.toBeDefined();

      writeFileSync(path.join(src, "dist/a.js"), "changed");
      await expect(copyPackedFiles(src, path.join(parent, "second"))).rejects.toThrow(
        /does not match its checksum/,
      );
    } finally {
      rmSync(src, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("names that exist on every object", () => {
  const listed = (files: Record<string, string>) =>
    parsePackManifest(
      JSON.stringify({
        format: 1,
        name: "p",
        version: "1.0.0",
        files: Object.fromEntries(
          Object.entries(files).map(([name, c]) => [
            name,
            { sha256: sha256Hex(c), size: Buffer.byteLength(c) },
          ]),
        ),
      }),
    );

  it("does not count constructor as listed unless the pack lists it", () => {
    const manifest = listed({ "a.js": "a" });
    expect(packListsFile(manifest, "constructor")).toBe(false);
    expect(packListsFile(manifest, "a.js")).toBe(true);
    expect(() =>
      comparePackFiles(
        manifest,
        new Map([
          ["a.js", manifest.files["a.js"]],
          ["constructor", manifest.files["a.js"]],
        ]),
      ),
    ).toThrow(/not listed/);
  });

  it("refuses __proto__ as a path", () => {
    expect(() => assertSafePackPath("__proto__")).toThrow(PackError);
    expect(() => assertSafePackPath("dir/__proto__/x.js")).toThrow(PackError);
    const text =
      '{"format":1,"name":"p","version":"1","files":{"__proto__":{"sha256":"' +
      "0".repeat(64) +
      '","size":1}}}';
    expect(() => parsePackManifest(text)).toThrow(PackError);
  });
});
