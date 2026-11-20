import AdmZip from "adm-zip";
import { promises as fs } from "fs";
import path from "path";
import { inflateRawSync } from "zlib";
import { parseCredentialDeclarations } from "@server/lib/plugin-credentials";
import { isKnownPluginCapability } from "@server/lib/plugin-capabilities";
import {
  PACK_LIMITS,
  PACK_MANIFEST_FILE,
  PackError,
  assertSafePackPath,
  comparePackFiles,
  packListsFile,
  parsePackManifest,
  sha256Hex,
  type PackManifest,
} from "@server/lib/plugin-pack";

const TOO_LARGE_MESSAGE = `ZIP file exceeds maximum unpacked size (${PACK_LIMITS.maxTotalBytes / (1024 * 1024)}MB)`;

/**
 * Archives opened at once in this process. Opening one holds up to
 * PACK_LIMITS.maxTotalBytes of inflated files in memory, so uploads queue here.
 */
export const MAX_CONCURRENT_ARCHIVES = 2;

let archivesOpen = 0;
const archiveQueue: Array<() => void> = [];

/** Run `work` once fewer than MAX_CONCURRENT_ARCHIVES other archive jobs are running. */
export async function withArchiveSlot<T>(work: () => Promise<T> | T): Promise<T> {
  if (archivesOpen >= MAX_CONCURRENT_ARCHIVES) {
    await new Promise<void>((resolve) => archiveQueue.push(resolve));
  } else {
    archivesOpen++;
  }
  try {
    return await work();
  } finally {
    // Hand the slot straight to the next waiter, or free it.
    const next = archiveQueue.shift();
    if (next) next();
    else archivesOpen--;
  }
}

/** ZIP compression methods a plugin archive may use. */
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/** Unix file-type bits stored in the high 16 bits of a ZIP entry's external attributes. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/**
 * Minimal view of a plugin's package.json used during upload validation.
 * Only the fields read here are declared; the parsed JSON is treated as
 * `unknown` and narrowed against this shape.
 */
interface PluginPackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  "hay-plugin"?: {
    entry?: string;
    displayName?: string;
    category?: string;
    capabilities?: string[];
    credentials?: unknown;
    autoActivate?: boolean;
    trpcRouter?: string;
  };
}

/**
 * Summary manifest derived from a plugin's package.json during upload.
 * This is distinct from the full `HayPluginManifest` persisted by
 * `pluginManagerService.registerPlugin`; it is only used to validate the
 * upload and to populate the HTTP response.
 */
export interface UploadedPluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  category?: string;
  entry: string;
  capabilities: string[];
}

function isSymlink(entry: AdmZip.IZipEntry): boolean {
  return ((entry.header.attr >>> 16) & S_IFMT) === S_IFLNK;
}

/** Stored ZIPs live in `plugin-zips/<id>`, and uploads.folder holds 100 characters. */
const PLUGIN_ID_MAX_LENGTH = 88;

/**
 * The bytes an entry inflates to. A header can understate an entry's size, so
 * inflation stops at the per-file cap whatever the header says.
 */
function readEntry(entry: AdmZip.IZipEntry): Buffer {
  const data = entry.getCompressedData();
  try {
    if (entry.header.method === METHOD_DEFLATED) {
      return inflateRawSync(data, { maxOutputLength: PACK_LIMITS.maxFileBytes });
    }
  } catch {
    throw new PackError(`${entry.entryName} could not be read from the ZIP or is too large`);
  }
  if (data.length > PACK_LIMITS.maxFileBytes) {
    throw new PackError(`${entry.entryName} could not be read from the ZIP or is too large`);
  }
  return data;
}

interface VerifiedPlugin {
  manifest: UploadedPluginManifest;
  pluginId: string;
  pack: PackManifest;
  /** `hay-pack.json` exactly as uploaded. */
  packText: string;
  /** Every file of the pack, as verified. */
  files: Map<string, Buffer>;
}

/**
 * Open a plugin archive and check it end to end, without writing anything:
 * entry count and size caps, no traversal, links, encryption or native addons,
 * every file matching `hay-pack.json`, and a valid manifest in `package.json`.
 */
function openPluginZip(zipBuffer: Buffer): VerifiedPlugin {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new Error("Invalid ZIP file structure");
  }
  const zipEntries = zip.getEntries();

  // Directory entries carry no content; only files count toward the pack.
  if (zipEntries.length > PACK_LIMITS.maxFiles * 2) {
    throw new Error(`ZIP file has too many entries (max ${PACK_LIMITS.maxFiles} files)`);
  }

  let declaredBytes = 0;
  const fileEntries: AdmZip.IZipEntry[] = [];
  for (const entry of zipEntries) {
    if (entry.header.encrypted) {
      throw new Error(`Encrypted entries are not allowed in ZIP: ${entry.entryName}`);
    }
    if (entry.header.method !== METHOD_STORED && entry.header.method !== METHOD_DEFLATED) {
      throw new Error(`Unsupported compression in ZIP: ${entry.entryName}`);
    }
    if (isSymlink(entry)) {
      throw new Error(`Symbolic links are not allowed in ZIP: ${entry.entryName}`);
    }
    if (entry.isDirectory) {
      assertSafePackPath(entry.entryName.replace(/\/+$/, ""));
      continue;
    }
    assertSafePackPath(entry.entryName);
    if (entry.header.size > PACK_LIMITS.maxFileBytes) {
      throw new Error(`${entry.entryName} could not be read from the ZIP or is too large`);
    }
    declaredBytes += entry.header.size;
    if (declaredBytes > PACK_LIMITS.maxTotalBytes) {
      throw new Error(TOO_LARGE_MESSAGE);
    }
    fileEntries.push(entry);
  }

  const files = new Map<string, Buffer>();
  const folded = new Set<string>();
  let packText: string | null = null;
  let actualBytes = 0;
  for (const entry of fileEntries) {
    const key = entry.entryName.toLowerCase();
    if (folded.has(key)) throw new Error(`ZIP lists a file twice: ${entry.entryName}`);
    folded.add(key);
    const data = readEntry(entry);
    actualBytes += data.length;
    if (actualBytes > PACK_LIMITS.maxTotalBytes) throw new Error(TOO_LARGE_MESSAGE);
    if (entry.entryName === PACK_MANIFEST_FILE) {
      packText = data.toString("utf8");
    } else {
      files.set(entry.entryName, data);
    }
  }

  if (packText === null) {
    throw new Error(
      `${PACK_MANIFEST_FILE} not found in ZIP root. Build the archive with "hay plugin pack".`,
    );
  }
  const pack = parsePackManifest(packText);
  comparePackFiles(
    pack,
    new Map(
      [...files].map(([name, data]) => [name, { sha256: sha256Hex(data), size: data.length }]),
    ),
  );

  const packageJson = files.get("package.json");
  if (!packageJson) {
    throw new Error("package.json not found in ZIP root");
  }
  const { manifest, pluginId } = describePackedPlugin(packageJson.toString("utf8"), pack);
  return { manifest, pluginId, pack, packText, files };
}

/**
 * Check a verified pack's `package.json` against its `hay-pack.json`: a valid
 * manifest, the same name and version, and an entry file that is in the pack.
 */
export function describePackedPlugin(
  packageJsonText: string,
  pack: PackManifest,
): { manifest: UploadedPluginManifest; pluginId: string } {
  const { manifest, pluginId } = parsePluginPackageJson(packageJsonText);
  if (pack.name !== pluginId || pack.version !== manifest.version) {
    throw new Error(`${PACK_MANIFEST_FILE} does not describe this package.json`);
  }
  if (!packListsFile(pack, path.posix.normalize(manifest.entry))) {
    throw new Error(`Plugin entry file ${manifest.entry} is not in the pack`);
  }
  return { manifest, pluginId };
}

/** Validate a plugin ZIP without extracting it. */
export function validatePluginZip(zipBuffer: Buffer): {
  manifest: UploadedPluginManifest;
  pluginId: string;
} {
  const { manifest, pluginId } = openPluginZip(zipBuffer);
  return { manifest, pluginId };
}

/**
 * Parse and validate an uploaded plugin's root package.json: it must carry a
 * `hay-plugin` block with an `entry` and capabilities core recognises (and no
 * core-only fields), and a valid package name (the plugin id).
 */
export function parsePluginPackageJson(content: string): {
  manifest: UploadedPluginManifest;
  pluginId: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("package.json is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("package.json must contain a JSON object");
  }

  const packageJson = parsed as PluginPackageJson;

  const hayPlugin = packageJson["hay-plugin"];
  if (!hayPlugin) {
    throw new Error("package.json must contain a 'hay-plugin' field");
  }

  if (!packageJson.name) {
    throw new Error("package.json missing required 'name' field");
  }

  if (!hayPlugin.entry) {
    throw new Error("hay-plugin missing required 'entry' field");
  }

  // Archives always carry organization-supplied plugins, which run only in
  // their own worker (see pluginManagerService.registerPlugin)
  if (hayPlugin.autoActivate || hayPlugin.trpcRouter) {
    throw new Error("autoActivate and trpcRouter are only supported for core plugins");
  }

  // Validate plugin ID format (npm package name)
  const pluginId = packageJson.name;
  if (!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(pluginId)) {
    throw new Error(
      "Plugin ID (package name) must be a valid npm package name (lowercase letters, numbers, hyphens, optional scope)",
    );
  }

  if (pluginId.length > PLUGIN_ID_MAX_LENGTH) {
    throw new Error(`Plugin ID (package name) must be at most ${PLUGIN_ID_MAX_LENGTH} characters`);
  }

  const capabilities = hayPlugin.capabilities ?? [];
  if (
    !Array.isArray(capabilities) ||
    !capabilities.every((capability) => typeof capability === "string")
  ) {
    throw new Error("hay-plugin capabilities must be a list of strings");
  }
  const unknown = capabilities.find((capability) => !isKnownPluginCapability(capability));
  if (unknown !== undefined) {
    throw new Error(`Unknown plugin capability: ${JSON.stringify(unknown)}`);
  }

  const declaredCredentials = parseCredentialDeclarations(hayPlugin.credentials);
  const missing = declaredCredentials.find(
    (credential) => !capabilities.includes(credential.capability),
  );
  if (missing) {
    throw new Error(
      `Credential ${missing.name} needs the '${missing.capability}' capability, which the plugin does not declare`,
    );
  }
  if (declaredCredentials.length > 0 && !capabilities.includes("credentials")) {
    throw new Error("A plugin that declares credentials must declare the 'credentials' capability");
  }

  const manifest: UploadedPluginManifest = {
    id: pluginId,
    name: hayPlugin.displayName || pluginId,
    version: packageJson.version || "1.0.0",
    description: packageJson.description || "",
    author: packageJson.author,
    category: hayPlugin.category,
    entry: hayPlugin.entry,
    capabilities,
  };

  return { manifest, pluginId };
}

/**
 * Validate a plugin ZIP, then write its verified files into `destDir`, a
 * directory that does not exist yet. Removes the directory again on failure.
 */
export async function extractPluginZip(zipBuffer: Buffer, destDir: string): Promise<void> {
  const { files, packText } = openPluginZip(zipBuffer);
  try {
    await fs.mkdir(destDir, { recursive: true });
    for (const [name, data] of files) {
      const target = path.join(destDir, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data, { flag: "wx" });
    }
    await fs.writeFile(path.join(destDir, PACK_MANIFEST_FILE), packText, {
      flag: "wx",
    });
  } catch (error) {
    await fs.rm(destDir, { recursive: true, force: true });
    throw error;
  }
}
