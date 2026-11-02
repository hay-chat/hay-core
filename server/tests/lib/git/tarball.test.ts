import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs, existsSync } from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { extractTarball, validateTarball } from "@server/lib/git/tarball";

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

const writePackageJson = (root: string) =>
  fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "git-plugin", "hay-plugin": { entry: "dist/index.js" } }),
  );

describe("extractTarball", () => {
  it("extracts regular files with the top-level directory stripped", async () => {
    const buffer = await buildTarball(async (root) => {
      await writePackageJson(root);
      await fs.mkdir(path.join(root, "dist"));
      await fs.writeFile(path.join(root, "dist", "index.js"), "module.exports = {};");
    });
    const dest = path.join(workDir, "out");

    await extractTarball(buffer, dest);

    expect(existsSync(path.join(dest, "package.json"))).toBe(true);
    expect(existsSync(path.join(dest, "dist", "index.js"))).toBe(true);
  });

  it("accepts a git archive (with its pax global header)", async () => {
    const repo = path.join(workDir, "repo");
    await fs.mkdir(repo);
    await writePackageJson(repo);
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
      await writePackageJson(root);
      await fs.symlink("/etc/passwd", path.join(root, "leak"));
    });
    const dest = path.join(workDir, "out");

    await expect(extractTarball(buffer, dest)).rejects.toThrow(/SymbolicLink/);
    expect(existsSync(dest)).toBe(false);
  });

  it("rejects hard links", async () => {
    const buffer = await buildTarball(async (root) => {
      await writePackageJson(root);
      await fs.link(path.join(root, "package.json"), path.join(root, "copy.json"));
    });

    await expect(extractTarball(buffer, path.join(workDir, "out"))).rejects.toThrow(/Link/);
  });

  it("rejects paths that climb out of the archive root", async () => {
    await fs.writeFile(path.join(workDir, "outside.txt"), "x");
    const buffer = await buildTarball(
      writePackageJson,
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
    const buffer = await buildTarball(writePackageJson);
    await expect(validateTarball(buffer)).resolves.toMatchObject({ pluginId: "git-plugin" });
  });

  it("rejects an archive without a hay-plugin package.json", async () => {
    const buffer = await buildTarball((root) =>
      fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "x" })),
    );
    await expect(validateTarball(buffer)).rejects.toThrow(/hay-plugin/);
  });
});
