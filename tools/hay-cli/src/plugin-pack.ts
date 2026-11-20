/**
 * hay plugin pack: turn a built plugin directory into the archive Hay installs.
 *
 * Core runs no package manager for an uploaded plugin, so everything the plugin
 * needs has to be in the archive. The plugin entry (and the entry of a bundled
 * mcp/ server) is bundled with its dependencies inlined; `@hay/plugin-sdk` stays
 * external because the host provides it. Every file is listed in hay-pack.json
 * with its size and sha256, which is what core checks on upload and again before
 * each worker starts.
 */
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  PACK_FORMAT_VERSION,
  PACK_LIMITS,
  PACK_MANIFEST_FILE,
  assertSafePackPath,
  parsePackManifest,
  sha256Hex,
  type PackManifest,
} from "../../../server/lib/plugin-pack";
import { UsageError, stringFlag } from "./args";
import type { CommandResult, Ctx } from "./commands";

/** Never packed: dependency trees, VCS data, secrets, and earlier pack output. */
const ALWAYS_EXCLUDED = new Set(["node_modules", ".git", ".DS_Store", PACK_MANIFEST_FILE]);
const EXCLUDED_NAME =
  /^(\.env(\..*)?|.*\.log|.*\.zip|.*\.tgz|package-lock\.json|npm-shrinkwrap\.json|\.npmrc)$/;

/** Fields of a packed package.json that only describe how to install or build it. */
const INSTALL_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "scripts",
  "overrides",
  "workspaces",
];

/** Provided by the host at run time. */
const HOST_PROVIDED = ["@hay/plugin-sdk"];

interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  files?: string[];
  "hay-plugin"?: { entry?: string };
  [key: string]: unknown;
}

export interface PackResult {
  archive: string;
  sha256: string;
  files: number;
  bytes: number;
  bundled: string[];
  manifest: PackManifest;
}

async function readJson(file: string): Promise<PackageJson> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as PackageJson;
  } catch (error) {
    throw new UsageError(
      `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

async function walk(root: string, relative: string, out: string[]): Promise<void> {
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (ALWAYS_EXCLUDED.has(entry.name) || EXCLUDED_NAME.test(entry.name)) continue;
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, name, out);
    else if (entry.isFile()) out.push(name);
    else throw new UsageError(`${name} is a link or special file; a pack holds regular files only`);
  }
}

/** The files to pack: those named by package.json "files" (plus package.json), else everything. */
async function collectFiles(dir: string, pkg: PackageJson): Promise<string[]> {
  const found: string[] = [];
  if (Array.isArray(pkg.files) && pkg.files.length > 0) {
    for (const item of pkg.files) {
      const relative = path.posix.normalize(item.replace(/^\.\//, ""));
      const stat = await fs.lstat(path.join(dir, relative)).catch(() => null);
      if (!stat) throw new UsageError(`package.json "files" lists ${item}, which does not exist`);
      if (stat.isDirectory()) await walk(dir, relative, found);
      else if (stat.isFile()) found.push(relative);
      else throw new UsageError(`${item} is a link or special file`);
    }
    found.push("package.json");
  } else {
    await walk(dir, "", found);
  }
  return [...new Set(found)].sort();
}

/** Bundle one entry file with its dependencies. */
async function bundleEntry(
  dir: string,
  entry: string,
  moduleType: "module" | "commonjs",
): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    // Relative module paths in the bundle, so it does not record the author's directories.
    absWorkingDir: dir,
    bundle: true,
    write: false,
    platform: "node",
    target: "node22",
    format: moduleType === "module" ? "esm" : "cjs",
    external: HOST_PROVIDED,
    sourcemap: false,
    logLevel: "silent",
    // An ES module bundle may still pull in CommonJS packages that call require().
    banner:
      moduleType === "module"
        ? {
            js: 'import { createRequire as __hayCreateRequire } from "node:module"; const require = __hayCreateRequire(import.meta.url);',
          }
        : undefined,
    loader: { ".node": "empty" },
  }).catch((error: Error & { errors?: { text: string }[] }) => {
    const detail = error.errors?.map((e) => e.text).join("; ") || error.message;
    throw new UsageError(`Could not bundle ${entry}: ${detail}`);
  });
  if (result.outputFiles.length !== 1) throw new UsageError(`Bundling ${entry} produced no output`);
  return result.outputFiles[0].text;
}

function installFree(pkg: PackageJson): Buffer {
  const copy: PackageJson = { ...pkg };
  for (const field of INSTALL_FIELDS) delete copy[field];
  return Buffer.from(JSON.stringify(copy, null, 2) + "\n");
}

/** Pack the plugin in `dir` into `archive`. */
export async function packPlugin(dir: string, archive: string): Promise<PackResult> {
  const root = path.resolve(dir);
  const pkg = await readJson(path.join(root, "package.json"));
  if (!pkg.name) throw new UsageError("package.json needs a name");
  const entry = pkg["hay-plugin"]?.entry;
  if (!entry) throw new UsageError('package.json needs "hay-plugin".entry');
  const entryPath = path.posix.normalize(entry.replace(/^\.\//, ""));
  if (!(await exists(path.join(root, entryPath)))) {
    throw new UsageError(`${entry} does not exist. Build the plugin first (e.g. npm run build).`);
  }

  const moduleType = pkg.type === "module" ? "module" : "commonjs";
  const contents = new Map<string, Buffer>();
  for (const file of await collectFiles(root, pkg)) {
    contents.set(file, await fs.readFile(path.join(root, file)));
  }
  if (!contents.has(entryPath)) {
    throw new UsageError(`${entry} is not covered by the package.json "files" list`);
  }

  const bundled: string[] = [];
  const bundle = async (file: string, type: "module" | "commonjs") => {
    contents.set(file, Buffer.from(await bundleEntry(root, file, type)));
    bundled.push(file);
  };
  await bundle(entryPath, moduleType);

  contents.set("package.json", installFree(pkg));

  // A bundled mcp/ server is a separate program with its own dependencies.
  const mcpManifest = path.join(root, "mcp", "package.json");
  if (await exists(mcpManifest)) {
    const mcpPkg = await readJson(mcpManifest);
    const mcpEntry = path.posix.join("mcp", (mcpPkg.main ?? "index.js").replace(/^\.\//, ""));
    if (!(await exists(path.join(root, mcpEntry)))) {
      throw new UsageError(`${mcpEntry} (the main file of mcp/package.json) does not exist`);
    }
    await bundle(mcpEntry, mcpPkg.type === "module" ? "module" : "commonjs");
    contents.set("mcp/package.json", installFree(mcpPkg));
  }

  const files: PackManifest["files"] = {};
  let bytes = 0;
  for (const [name, data] of [...contents].sort(([a], [b]) => (a < b ? -1 : 1))) {
    assertSafePackPath(name);
    files[name] = { sha256: sha256Hex(data), size: data.length };
    bytes += data.length;
  }
  const manifest: PackManifest = {
    format: PACK_FORMAT_VERSION,
    name: pkg.name,
    version: pkg.version ?? "1.0.0",
    files,
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  // Core applies the same rules on upload; failing here saves the round trip.
  parsePackManifest(manifestText);
  if (Object.keys(files).length > PACK_LIMITS.maxFiles) {
    throw new UsageError(
      `Too many files (${Object.keys(files).length}, max ${PACK_LIMITS.maxFiles})`,
    );
  }

  const zip = new AdmZip();
  for (const [name, data] of [...contents].sort(([a], [b]) => (a < b ? -1 : 1))) {
    zip.addFile(name, data);
  }
  zip.addFile(PACK_MANIFEST_FILE, Buffer.from(manifestText));
  const buffer = zip.toBuffer();
  await fs.mkdir(path.dirname(path.resolve(archive)), { recursive: true });
  await fs.writeFile(archive, buffer);

  return {
    archive: path.resolve(archive),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    files: Object.keys(files).length,
    bytes,
    bundled,
    manifest,
  };
}

/** hay plugin pack [dir] [--out <file.zip>] */
export async function pluginPack(ctx: Ctx): Promise<CommandResult> {
  const dir = ctx.args.positionals[2] ?? ".";
  const pkg = await readJson(path.join(path.resolve(dir), "package.json"));
  const out =
    stringFlag(ctx.args, "out") ??
    `${(pkg.name ?? "plugin").replace(/^@/, "").replace("/", "-")}-${pkg.version ?? "1.0.0"}.zip`;
  const result = await packPlugin(dir, out);
  return {
    data: {
      archive: result.archive,
      sha256: result.sha256,
      files: result.files,
      bytes: result.bytes,
      bundled: result.bundled,
    },
    text: [
      `packed ${result.manifest.name}@${result.manifest.version}: ${result.files} files, ${result.bytes} bytes`,
      `bundled: ${result.bundled.join(", ")}`,
      `archive: ${result.archive}`,
      `sha256:  ${result.sha256}`,
    ],
  };
}
