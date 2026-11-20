import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs, existsSync } from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { extractTarball, validateTarball } from "@server/lib/git/tarball";
import { sha256Hex } from "@server/lib/plugin-pack";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const tar = require("tar") as {
  c: (opts: Record<string, unknown>, files: string[]) => Promise<void>;
};

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "tarball-test-"));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

/** Build a GitHub-style tarball: everything under one "repo-sha/" root dir. */
async function buildTarball(
  populate: (root: string) => Promise<void>,
  opts: Record<string, unknown> = {},
  files: string[] = ["repo-sha"],
): Promise<Buffer> {
  const src = path.join(workDir, "src");
  const root = path.join(src, "repo-sha");
  await fs.mkdir(root, { recursive: true });
  await populate(root);
  const out = path.join(workDir, "archive.tar.gz");
  await tar.c({ gzip: true, file: out, cwd: src, ...opts }, files);
  return fs.readFile(out);
}

const PACKAGE_JSON = JSON.stringify({
  name: "git-plugin",
  "hay-plugin": { entry: "dist/index.js" },
});
const ENTRY = "module.exports = {};";

/** package.json, the entry file and the hay-pack.json that lists them. */
async function writePack(root: string, entry = ENTRY, listedEntry = entry) {
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), PACKAGE_JSON);
  await fs.writeFile(path.join(root, "dist", "index.js"), entry);
  const listed = (name: string, content: string) => ({
    [name]: { sha256: sha256Hex(content), size: Buffer.byteLength(content) },
  });
  await fs.writeFile(
    path.join(root, "hay-pack.json"),
    JSON.stringify({
      format: 1,
      name: "git-plugin",
      version: "1.0.0",
      files: { ...listed("package.json", PACKAGE_JSON), ...listed("dist/index.js", listedEntry) },
    }),
  );
}

describe("extractTarball", () => {
  it("installs the listed files with the top-level directory stripped, and nothing else", async () => {
    const buffer = await buildTarball(async (root) => {
      await writePack(root);
      await fs.mkdir(path.join(root, "src"));
      await fs.writeFile(path.join(root, "src", "index.ts"), "export {};");
      await fs.writeFile(path.join(root, "README.md"), "docs");
    });
    const dest = path.join(workDir, "out");

    await extractTarball(buffer, dest);

    expect(existsSync(path.join(dest, "package.json"))).toBe(true);
    expect(existsSync(path.join(dest, "dist", "index.js"))).toBe(true);
    expect(existsSync(path.join(dest, "hay-pack.json"))).toBe(true);
    expect(existsSync(path.join(dest, "src"))).toBe(false);
    expect(existsSync(path.join(dest, "README.md"))).toBe(false);
  });

  it("refuses a repository without a pack and removes the destination", async () => {
    const buffer = await buildTarball(async (root) => {
      await fs.writeFile(path.join(root, "package.json"), PACKAGE_JSON);
    });
    const dest = path.join(workDir, "out");

    await expect(extractTarball(buffer, dest)).rejects.toThrow(/hay plugin pack/);
    expect(existsSync(dest)).toBe(false);
  });

  it("refuses a listed file that differs from its checksum", async () => {
    const buffer = await buildTarball((root) => writePack(root, "require('fs');", ENTRY));
    const dest = path.join(workDir, "out");

    await expect(extractTarball(buffer, dest)).rejects.toThrow(/does not match its checksum/);
    expect(existsSync(dest)).toBe(false);
  });

  it("accepts a git archive (with its pax global header)", async () => {
    const repo = path.join(workDir, "repo");
    await fs.mkdir(repo);
    await writePack(repo);
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo });
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "init");
    const buffer = execFileSync(
      "git",
      ["archive", "--format=tar.gz", "--prefix=repo-sha/", "HEAD"],
      {
        cwd: repo,
      },
    );

    await expect(validateTarball(buffer)).resolves.toMatchObject({ pluginId: "git-plugin" });
  });

  it("rejects symbolic links and removes the destination", async () => {
    const buffer = await buildTarball(async (root) => {
      await writePack(root);
      await fs.symlink("/etc/passwd", path.join(root, "leak"));
    });
    const dest = path.join(workDir, "out");

    await expect(extractTarball(buffer, dest)).rejects.toThrow(/SymbolicLink/);
    expect(existsSync(dest)).toBe(false);
  });

  it("rejects hard links", async () => {
    const buffer = await buildTarball(async (root) => {
      await writePack(root);
      await fs.link(path.join(root, "package.json"), path.join(root, "copy.json"));
    });

    await expect(extractTarball(buffer, path.join(workDir, "out"))).rejects.toThrow(/Link/);
  });

  it("rejects paths that climb out of the archive root", async () => {
    await fs.writeFile(path.join(workDir, "outside.txt"), "x");
    const buffer = await buildTarball(
      writePack,
      { preservePaths: true, cwd: path.join(workDir, "src", "repo-sha") },
      ["package.json", "../../outside.txt"],
    );

    await expect(extractTarball(buffer, path.join(workDir, "out"))).rejects.toThrow(
      /Invalid file path/,
    );
    expect(existsSync(path.join(workDir, "outside.txt"))).toBe(true);
  });
});

describe("validateTarball", () => {
  it("returns the plugin id from the root package.json", async () => {
    const buffer = await buildTarball(writePack);
    await expect(validateTarball(buffer)).resolves.toMatchObject({ pluginId: "git-plugin" });
  });

  it("rejects an archive without a hay-plugin package.json", async () => {
    const buffer = await buildTarball(async (root) => {
      const content = JSON.stringify({ name: "x" });
      await fs.writeFile(path.join(root, "package.json"), content);
      await fs.writeFile(
        path.join(root, "hay-pack.json"),
        JSON.stringify({
          format: 1,
          name: "x",
          version: "1.0.0",
          files: { "package.json": { sha256: sha256Hex(content), size: content.length } },
        }),
      );
    });
    await expect(validateTarball(buffer)).rejects.toThrow(/hay-plugin/);
  });
});
