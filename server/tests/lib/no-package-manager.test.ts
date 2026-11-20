/**
 * Core, the plugin host and the plugin SDK never start a package manager for a
 * plugin. The one exception is a development checkout installing and building
 * its own bundled (core) plugins, kept in plugin-manager.service.ts behind a
 * source-type and production check; new call sites must not appear elsewhere.
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SCANNED = ["server", "packages/plugin-sdk"];
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "tests",
  "__tests__",
  "migrations",
  "scripts",
]);

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sources(full);
    return /\.(ts|js|mjs|cjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

const PACKAGE_MANAGER_CALL =
  /\b(execSync|execFileSync|exec|execFile|spawn|spawnSync)\(\s*[`"'](npm|npx|yarn|pnpm)\b/;

describe("package managers at run time", () => {
  const offenders = SCANNED.flatMap((dir) => sources(path.join(ROOT, dir)))
    .filter((file) => PACKAGE_MANAGER_CALL.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(ROOT, file));

  it("are started only by the development install of bundled plugins", () => {
    expect(offenders).toEqual(["server/services/plugin-manager.service.ts"]);
  });

  it("are not started with a npm command built from a variable", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "server/services/plugin-manager.service.ts"),
      "utf8",
    );
    const installBranch = source.slice(
      source.indexOf("async installPlugin"),
      source.indexOf("async buildPlugin"),
    );
    // Uploaded and git plugins return before the first command is built.
    expect(installBranch.indexOf('plugin.sourceType !== "core"')).toBeGreaterThan(-1);
    expect(installBranch.indexOf('plugin.sourceType !== "core"')).toBeLessThan(
      installBranch.indexOf("execSync"),
    );
  });
});
