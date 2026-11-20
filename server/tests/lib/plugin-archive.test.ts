import { describe, it, expect } from "@jest/globals";
import AdmZip from "adm-zip";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  MAX_CONCURRENT_ARCHIVES,
  extractPluginZip,
  validatePluginZip,
  withArchiveSlot,
} from "@server/lib/plugin-archive";
import {
  PACK_LIMITS,
  PACK_MANIFEST_FILE,
  sha256Hex,
  verifyPackedTree,
} from "@server/lib/plugin-pack";

const packageJson = (name = "my-plugin", hayPlugin: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      name,
      version: "1.2.3",
      "hay-plugin": { entry: "dist/index.js", ...hayPlugin },
    }),
  );

/** The pack manifest `hay plugin pack` would write for these files. */
function packManifest(files: Record<string, Buffer>, overrides: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      format: 1,
      name: "my-plugin",
      version: "1.2.3",
      files: Object.fromEntries(
        Object.entries(files).map(([name, data]) => [
          name,
          { sha256: sha256Hex(data), size: data.length },
        ]),
      ),
      ...overrides,
    }),
  );
}

const defaultFiles = (): Record<string, Buffer> => ({
  "package.json": packageJson(),
  "dist/index.js": Buffer.from("module.exports = {};"),
});

interface ZipOptions {
  /** Files in the archive but not described by the manifest. */
  extra?: Record<string, Buffer>;
  /** Replace the manifest (null: leave it out). */
  manifest?: Buffer | null;
  symlinks?: Record<string, string>;
  manifestOverrides?: Record<string, unknown>;
}

function packedZip(files: Record<string, Buffer> = defaultFiles(), options: ZipOptions = {}) {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries({ ...files, ...options.extra })) {
    zip.addFile(name, data);
  }
  for (const [name, target] of Object.entries(options.symlinks ?? {})) {
    // Unix mode S_IFLNK | 0777 in the high 16 bits of the external attributes
    // (as `zip -y` writes it; adm-zip's addFile would force a regular file)
    zip.addFile(name, Buffer.from(target)).header.attr = (0o120777 << 16) >>> 0;
  }
  const manifest =
    options.manifest === undefined
      ? packManifest(files, options.manifestOverrides)
      : options.manifest;
  if (manifest) zip.addFile(PACK_MANIFEST_FILE, manifest);
  return zip.toBuffer();
}

describe("validatePluginZip", () => {
  it("accepts a packed plugin", () => {
    const result = validatePluginZip(packedZip());
    expect(result.pluginId).toBe("my-plugin");
    expect(result.manifest.version).toBe("1.2.3");
  });

  it("rejects an archive that is not a pack", () => {
    expect(() => validatePluginZip(packedZip(defaultFiles(), { manifest: null }))).toThrow(
      /hay-pack\.json not found.*hay plugin pack/,
    );
  });

  it("rejects a file that changed after packing", () => {
    const files = defaultFiles();
    const zip = packedZip(files, { manifest: packManifest(files) });
    const tampered = new AdmZip(zip);
    tampered.updateFile("dist/index.js", Buffer.from("require('child_process');"));
    expect(() => validatePluginZip(tampered.toBuffer())).toThrow(
      /dist\/index\.js does not match its checksum/,
    );
  });

  it("rejects a file the pack does not list", () => {
    expect(() =>
      validatePluginZip(
        packedZip(defaultFiles(), { extra: { "dist/extra.js": Buffer.from("x") } }),
      ),
    ).toThrow(/dist\/extra\.js is not listed/);
  });

  it("rejects an entry file that the pack does not list, even a name every object has", () => {
    const files = {
      ...defaultFiles(),
      "package.json": packageJson("my-plugin", { entry: "constructor" }),
    };
    expect(() => validatePluginZip(packedZip(files))).toThrow(
      /entry file constructor is not in the pack/,
    );
  });

  it("rejects a file declared larger than the per-file limit before inflating it", () => {
    const zip = new AdmZip(packedZip());
    zip.getEntry("dist/index.js")!.header.size = PACK_LIMITS.maxFileBytes + 1;
    expect(() => validatePluginZip(zip.toBuffer())).toThrow(/too large/);
  });

  it("rejects a listed file that is missing", () => {
    const files = defaultFiles();
    const manifest = packManifest({ ...files, "dist/missing.js": Buffer.from("x") });
    expect(() => validatePluginZip(packedZip(files, { manifest }))).toThrow(
      /missing dist\/missing\.js/,
    );
  });

  it("rejects symbolic link entries", () => {
    expect(() =>
      validatePluginZip(packedZip(defaultFiles(), { symlinks: { "dist/link": "/etc/passwd" } })),
    ).toThrow(/Symbolic links are not allowed/);
  });

  it.each([
    ["a parent directory", "../evil.js"],
    ["a nested parent directory", "dist/../../evil.js"],
    ["an absolute path", "/etc/cron.d/evil"],
    ["a backslash", "dist\\evil.js"],
    ["a drive letter", "C:/evil.js"],
    ["an empty segment", "dist//evil.js"],
  ])("rejects a path with %s", (_label, name) => {
    const zip = new AdmZip(packedZip());
    zip.addFile("placeholder", Buffer.from("x"));
    // adm-zip normalizes names given to addFile; set the stored name directly.
    zip.getEntry("placeholder")!.entryName = name;
    expect(() => validatePluginZip(zip.toBuffer())).toThrow(/Invalid file path/);
  });

  it("rejects the same path twice in different case", () => {
    const zip = new AdmZip();
    zip.addFile("package.json", packageJson());
    zip.addFile("dist/index.js", Buffer.from("a"));
    zip.addFile("Dist/Index.js", Buffer.from("b"));
    zip.addFile(PACK_MANIFEST_FILE, packManifest(defaultFiles()));
    expect(() => validatePluginZip(zip.toBuffer())).toThrow(/lists a file twice/);
  });

  it("rejects a native addon", () => {
    const files = { ...defaultFiles(), "build/addon.node": Buffer.from("ELF") };
    expect(() => validatePluginZip(packedZip(files))).toThrow(/Native addons are not supported/);
  });

  it("rejects a file that inflates past the per-file limit whatever its header says", () => {
    const files = {
      ...defaultFiles(),
      "dist/big.js": Buffer.alloc(PACK_LIMITS.maxFileBytes + 1024),
    };
    const manifest = packManifest(defaultFiles());
    expect(() => validatePluginZip(packedZip(files, { manifest }))).toThrow(
      /too large|could not be read/,
    );
  });

  it("rejects a manifest that declares a file over the limit", () => {
    const files = defaultFiles();
    const manifest = JSON.parse(packManifest(files).toString());
    manifest.files["dist/index.js"].size = PACK_LIMITS.maxFileBytes + 1;
    expect(() =>
      validatePluginZip(packedZip(files, { manifest: Buffer.from(JSON.stringify(manifest)) })),
    ).toThrow(/larger than/);
  });

  it("rejects a manifest that declares more unpacked bytes than the limit", () => {
    const files = defaultFiles();
    const manifest = JSON.parse(packManifest(files).toString());
    for (let i = 0; i < 5; i++) {
      manifest.files[`pad/${i}.js`] = {
        sha256: "0".repeat(64),
        size: PACK_LIMITS.maxFileBytes,
      };
    }
    expect(() =>
      validatePluginZip(packedZip(files, { manifest: Buffer.from(JSON.stringify(manifest)) })),
    ).toThrow(/larger than/);
  });

  it("rejects a pack with too many files", () => {
    const manifest = JSON.parse(packManifest(defaultFiles()).toString());
    for (let i = 0; i <= PACK_LIMITS.maxFiles; i++) {
      manifest.files[`f/${i}.js`] = { sha256: "0".repeat(64), size: 0 };
    }
    expect(() =>
      validatePluginZip(
        packedZip(defaultFiles(), { manifest: Buffer.from(JSON.stringify(manifest)) }),
      ),
    ).toThrow(/too many files/);
  });

  it("rejects an unsupported pack format", () => {
    expect(() =>
      validatePluginZip(packedZip(defaultFiles(), { manifestOverrides: { format: 2 } })),
    ).toThrow(/Unsupported plugin pack format/);
  });

  it("rejects a pack that describes another package", () => {
    expect(() =>
      validatePluginZip(packedZip(defaultFiles(), { manifestOverrides: { name: "other" } })),
    ).toThrow(/does not describe this package\.json/);
    expect(() =>
      validatePluginZip(packedZip(defaultFiles(), { manifestOverrides: { version: "9.9.9" } })),
    ).toThrow(/does not describe this package\.json/);
  });

  it("rejects an entry file that is not in the pack", () => {
    const files = { "package.json": packageJson("my-plugin", { entry: "dist/missing.js" }) };
    expect(() => validatePluginZip(packedZip(files))).toThrow(/entry file .* is not in the pack/);
  });

  it("rejects a capability core does not recognise", () => {
    const files = {
      ...defaultFiles(),
      "package.json": packageJson("my-plugin", { capabilities: ["messages", "root"] }),
    };
    expect(() => validatePluginZip(packedZip(files))).toThrow(/Unknown plugin capability/);
  });

  it("only accepts package.json at the archive root", () => {
    const files = { "nested/package.json": packageJson(), "dist/index.js": Buffer.from("") };
    expect(() => validatePluginZip(packedZip(files))).toThrow(/package.json not found in ZIP root/);
  });

  it("rejects an invalid package name", () => {
    const files = { ...defaultFiles(), "package.json": packageJson("../escape") };
    expect(() =>
      validatePluginZip(packedZip(files, { manifestOverrides: { name: "../escape" } })),
    ).toThrow(/valid npm package name/);
  });

  it("limits the package name so its storage folder fits", () => {
    const fits = `@${"a".repeat(40)}/${"b".repeat(46)}`;
    const named = (name: string) => ({ ...defaultFiles(), "package.json": packageJson(name) });
    expect(
      validatePluginZip(packedZip(named(fits), { manifestOverrides: { name: fits } })).pluginId,
    ).toBe(fits);
    expect(() =>
      validatePluginZip(packedZip(named(`${fits}c`), { manifestOverrides: { name: `${fits}c` } })),
    ).toThrow("at most 88");
  });

  it("rejects core-only manifest fields", () => {
    const files = {
      ...defaultFiles(),
      "package.json": packageJson("my-plugin", { trpcRouter: "router.cjs" }),
    };
    expect(() => validatePluginZip(packedZip(files))).toThrow(/only supported for core/);
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

  it("writes every file, stored or deflated, including empty ones, and the manifest", async () => {
    await withDestination(async (dest) => {
      await extractPluginZip(
        packedZip({
          ...defaultFiles(),
          "dist/index.js": Buffer.from("x".repeat(5000)),
          "dist/empty.js": Buffer.from(""),
        }),
        dest,
      );

      expect(readFileSync(path.join(dest, "dist/index.js"), "utf8")).toBe("x".repeat(5000));
      expect(readFileSync(path.join(dest, "dist/empty.js"), "utf8")).toBe("");
      await expect(verifyPackedTree(dest)).resolves.toMatchObject({ name: "my-plugin" });
    });
  });

  it("writes nothing for an archive that fails validation", async () => {
    await withDestination(async (dest) => {
      await expect(
        extractPluginZip(
          packedZip(defaultFiles(), { extra: { "dist/extra.js": Buffer.from("x") } }),
          dest,
        ),
      ).rejects.toThrow(/not listed/);
      expect(existsSync(dest)).toBe(false);
    });
  });

  it("leaves a tree that verifyPackedTree rejects once a file is changed or added", async () => {
    await withDestination(async (dest) => {
      await extractPluginZip(packedZip(), dest);
      writeFileSync(path.join(dest, "dist/index.js"), "tampered");
      await expect(verifyPackedTree(dest)).rejects.toThrow(/does not match its checksum/);
    });
    await withDestination(async (dest) => {
      await extractPluginZip(packedZip(), dest);
      writeFileSync(path.join(dest, "dist/new.js"), "added");
      await expect(verifyPackedTree(dest)).rejects.toThrow(/not listed/);
    });
  });
});

describe("withArchiveSlot", () => {
  it("runs no more than the limit at once and finishes them all", async () => {
    let running = 0;
    let peak = 0;
    const job = () =>
      withArchiveSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;
        return 1;
      });
    const results = await Promise.all(Array.from({ length: MAX_CONCURRENT_ARCHIVES * 3 }, job));
    expect(results.length).toBe(MAX_CONCURRENT_ARCHIVES * 3);
    expect(peak).toBe(MAX_CONCURRENT_ARCHIVES);
  });

  it("frees its slot when the work fails", async () => {
    await expect(withArchiveSlot(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await expect(withArchiveSlot(() => 5)).resolves.toBe(5);
  });
});
