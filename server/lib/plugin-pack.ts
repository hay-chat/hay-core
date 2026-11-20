/**
 * The packed plugin format.
 *
 * `hay plugin pack` turns a plugin directory into a tree whose dependencies are
 * already resolved (bundled into its entry files) and describes every file in
 * `hay-pack.json`: path, size and sha256. Core installs nothing: it checks that
 * an uploaded archive, and later the extracted directory, are exactly what that
 * file describes, and runs the plugin as it is.
 *
 * This module is plain Node (no `@server` imports) because the `hay` CLI uses it
 * to write the manifest and to check its own output.
 */
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export const PACK_MANIFEST_FILE = "hay-pack.json";
export const PACK_FORMAT_VERSION = 1;

const MB = 1024 * 1024;

/** What a packed plugin may hold. Bundled plugins are far below these. */
export const PACK_LIMITS = {
  maxFiles: 5_000,
  maxFileBytes: 25 * MB,
  maxTotalBytes: 100 * MB,
  maxPathLength: 512,
  maxSegmentLength: 255,
} as const;

/** Native code cannot be bundled or checked, so it is not accepted. */
const FORBIDDEN_EXTENSIONS = [".node"];

export interface PackFileInfo {
  sha256: string;
  size: number;
}

export interface PackManifest {
  format: number;
  name: string;
  version: string;
  files: Record<string, PackFileInfo>;
}

/** A packed plugin that breaks the format; the message is safe to show the uploader. */
export class PackError extends Error {}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Throws unless `name` is a normalized relative path with plain segments:
 * no traversal, absolute or drive paths, backslashes, control characters or
 * empty segments, and not a native addon.
 */
export function assertSafePackPath(name: string): void {
  const bad = (reason: string) =>
    new PackError(`Invalid file path in plugin pack (${reason}): ${JSON.stringify(name)}`);
  if (name.length === 0 || name.length > PACK_LIMITS.maxPathLength) throw bad("length");
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(name)) throw bad("characters");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw bad("absolute");
  const segments = name.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") throw bad("segment");
    if (segment === "__proto__") throw bad("segment");
    if (segment.length > PACK_LIMITS.maxSegmentLength) throw bad("segment length");
  }
  const lower = name.toLowerCase();
  if (FORBIDDEN_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    throw new PackError(`Native addons are not supported in a plugin pack: ${name}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse and validate `hay-pack.json`. */
export function parsePackManifest(text: string): PackManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PackError(`${PACK_MANIFEST_FILE} is not valid JSON`);
  }
  if (!isRecord(parsed)) throw new PackError(`${PACK_MANIFEST_FILE} must be a JSON object`);
  if (parsed.format !== PACK_FORMAT_VERSION) {
    throw new PackError(
      `Unsupported plugin pack format ${JSON.stringify(parsed.format)} (expected ${PACK_FORMAT_VERSION})`,
    );
  }
  if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new PackError(`${PACK_MANIFEST_FILE} needs a name and a version`);
  }
  if (!isRecord(parsed.files)) throw new PackError(`${PACK_MANIFEST_FILE} needs a files list`);

  const entries = Object.entries(parsed.files);
  if (entries.length > PACK_LIMITS.maxFiles) {
    throw new PackError(`Plugin pack has too many files (max ${PACK_LIMITS.maxFiles})`);
  }
  // No prototype, so names like "constructor" are never listed unless the pack lists them.
  const files: Record<string, PackFileInfo> = Object.create(null);
  const seen = new Set<string>();
  for (const [name, info] of entries) {
    assertSafePackPath(name);
    if (name === PACK_MANIFEST_FILE)
      throw new PackError(`${PACK_MANIFEST_FILE} cannot list itself`);
    const folded = name.toLowerCase();
    if (seen.has(folded)) throw new PackError(`Plugin pack lists a file twice: ${name}`);
    seen.add(folded);
    if (
      !isRecord(info) ||
      typeof info.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(info.sha256) ||
      typeof info.size !== "number" ||
      !Number.isSafeInteger(info.size) ||
      info.size < 0
    ) {
      throw new PackError(`Invalid checksum entry for ${name}`);
    }
    if (info.size > PACK_LIMITS.maxFileBytes) {
      throw new PackError(`${name} is larger than ${PACK_LIMITS.maxFileBytes / MB} MB`);
    }
    files[name] = { sha256: info.sha256, size: info.size };
  }
  const total = Object.values(files).reduce((sum, file) => sum + file.size, 0);
  if (total > PACK_LIMITS.maxTotalBytes) {
    throw new PackError(`Plugin pack is larger than ${PACK_LIMITS.maxTotalBytes / MB} MB unpacked`);
  }
  return { format: PACK_FORMAT_VERSION, name: parsed.name, version: parsed.version, files };
}

/** Whether the pack lists `name` itself (not through the prototype chain). */
export function packListsFile(manifest: PackManifest, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(manifest.files, name);
}

/** Throws unless `actual` holds exactly the files, sizes and hashes the manifest lists. */
export function comparePackFiles(
  manifest: PackManifest,
  actual: ReadonlyMap<string, PackFileInfo>,
): void {
  for (const [name, expected] of Object.entries(manifest.files)) {
    const found = actual.get(name);
    if (!found) throw new PackError(`Plugin pack is missing ${name}`);
    if (found.size !== expected.size || found.sha256 !== expected.sha256) {
      throw new PackError(`${name} does not match its checksum in ${PACK_MANIFEST_FILE}`);
    }
  }
  for (const name of actual.keys()) {
    if (!Object.prototype.hasOwnProperty.call(manifest.files, name)) {
      throw new PackError(`${name} is not listed in ${PACK_MANIFEST_FILE}`);
    }
  }
}

async function walk(
  root: string,
  relative: string,
  out: Map<string, PackFileInfo>,
  budget: { bytes: number },
): Promise<void> {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(root, name, out, budget);
      continue;
    }
    if (!entry.isFile()) {
      throw new PackError(`Only regular files are allowed in a plugin pack: ${name}`);
    }
    if (name === PACK_MANIFEST_FILE) continue;
    assertSafePackPath(name);
    if (out.size >= PACK_LIMITS.maxFiles) {
      throw new PackError(`Plugin pack has too many files (max ${PACK_LIMITS.maxFiles})`);
    }
    const data = await fs.readFile(path.join(root, name));
    budget.bytes += data.length;
    if (data.length > PACK_LIMITS.maxFileBytes || budget.bytes > PACK_LIMITS.maxTotalBytes) {
      throw new PackError("Plugin pack exceeds its size limit");
    }
    out.set(name, { sha256: sha256Hex(data), size: data.length });
  }
}

/** Hash every file under `dir` (except the manifest); anything but a regular file is refused. */
export async function readPackTree(dir: string): Promise<Map<string, PackFileInfo>> {
  const files = new Map<string, PackFileInfo>();
  await walk(dir, "", files, { bytes: 0 });
  return files;
}

/**
 * Check a directory against its `hay-pack.json`: every listed file present and
 * unchanged, nothing else there. Returns the manifest.
 */
export async function verifyPackedTree(dir: string): Promise<PackManifest> {
  let text: string;
  try {
    text = await fs.readFile(path.join(dir, PACK_MANIFEST_FILE), "utf8");
  } catch {
    throw new PackError(
      `This plugin has no ${PACK_MANIFEST_FILE}. Plugins are installed as packs: build one with "hay plugin pack" and upload it again.`,
    );
  }
  const manifest = parsePackManifest(text);
  comparePackFiles(manifest, await readPackTree(dir));
  return manifest;
}

/**
 * Copy the files a pack lists from `srcDir` into `destDir` (which must not exist
 * yet), checking each against its checksum. Files the pack does not list are
 * left behind: the pack is the allow-list, so a repository checkout can hold
 * sources and tooling next to it.
 */
export async function copyPackedFiles(srcDir: string, destDir: string): Promise<PackManifest> {
  let text: string;
  try {
    text = await fs.readFile(path.join(srcDir, PACK_MANIFEST_FILE), "utf8");
  } catch {
    throw new PackError(
      `No ${PACK_MANIFEST_FILE} found. Plugins are installed as packs: build one with "hay plugin pack".`,
    );
  }
  const manifest = parsePackManifest(text);
  await fs.mkdir(destDir, { recursive: true });
  for (const [name, expected] of Object.entries(manifest.files)) {
    const source = path.join(srcDir, name);
    const stat = await fs.lstat(source).catch(() => null);
    if (!stat?.isFile()) throw new PackError(`Plugin pack is missing ${name}`);
    const data = await fs.readFile(source);
    comparePackFiles(
      { ...manifest, files: Object.assign(Object.create(null), { [name]: expected }) },
      new Map([[name, { sha256: sha256Hex(data), size: data.length }]]),
    );
    const target = path.join(destDir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: "wx" });
  }
  await fs.writeFile(path.join(destDir, PACK_MANIFEST_FILE), text, { flag: "wx" });
  return manifest;
}
