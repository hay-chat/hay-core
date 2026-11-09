import AdmZip from "adm-zip";
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { PassThrough, Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { createInflateRaw, inflateRawSync } from "zlib";

/** Caps for an uploaded plugin ZIP. */
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const TOO_LARGE_MESSAGE = "ZIP file exceeds maximum uncompressed size (500MB)";

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

function isUnsafeEntryName(name: string): boolean {
  if (name.includes("\\") || name.includes("\0") || path.isAbsolute(name)) {
    return true;
  }
  const normalized = path.posix.normalize(name);
  return normalized === ".." || normalized.startsWith("../");
}

/** Decode the root package.json, trusting the bytes it inflates to rather than its header. */
function readPackageJson(entry: AdmZip.IZipEntry): string {
  const data = entry.getCompressedData();
  try {
    if (entry.header.method === METHOD_DEFLATED) {
      return inflateRawSync(data, { maxOutputLength: MAX_PACKAGE_JSON_BYTES }).toString("utf8");
    }
  } catch {
    throw new Error("package.json could not be read from the ZIP or is too large");
  }
  if (data.length > MAX_PACKAGE_JSON_BYTES) {
    throw new Error("package.json could not be read from the ZIP or is too large");
  }
  return data.toString("utf8");
}

/** Stored ZIPs live in `plugin-zips/<id>`, and uploads.folder holds 100 characters. */
const PLUGIN_ID_MAX_LENGTH = 88;

/**
 * Validate a plugin ZIP without extracting it: declared size/entry caps, no path
 * traversal, no symlinks, and a valid root `package.json`. A header can
 * understate an entry's size, so `extractPluginZip` also counts what it writes.
 */
export function validatePluginZip(zipBuffer: Buffer): {
  manifest: UploadedPluginManifest;
  pluginId: string;
} {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new Error("Invalid ZIP file structure");
  }
  const zipEntries = zip.getEntries();

  if (zipEntries.length > MAX_ENTRIES) {
    throw new Error(`ZIP file has too many entries (max ${MAX_ENTRIES})`);
  }

  let totalUncompressedSize = 0;
  for (const entry of zipEntries) {
    totalUncompressedSize += entry.header.size;
    if (totalUncompressedSize > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(TOO_LARGE_MESSAGE);
    }
    if (entry.header.encrypted) {
      throw new Error(`Encrypted entries are not allowed in ZIP: ${entry.entryName}`);
    }
    if (entry.header.method !== METHOD_STORED && entry.header.method !== METHOD_DEFLATED) {
      throw new Error(`Unsupported compression in ZIP: ${entry.entryName}`);
    }
    if (isUnsafeEntryName(entry.entryName)) {
      throw new Error(`Invalid file path in ZIP: ${entry.entryName}`);
    }
    if (isSymlink(entry)) {
      throw new Error(`Symbolic links are not allowed in ZIP: ${entry.entryName}`);
    }
  }

  const packageEntry = zipEntries.find((e) => e.entryName === "package.json");
  if (!packageEntry) {
    throw new Error("package.json not found in ZIP root");
  }

  return parsePluginPackageJson(readPackageJson(packageEntry));
}

/**
 * Parse and validate an uploaded plugin's root package.json: it must carry a
 * `hay-plugin` block with an `entry` (and no core-only fields), and a valid
 * package name (the plugin id).
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

  const manifest: UploadedPluginManifest = {
    id: pluginId,
    name: hayPlugin.displayName || pluginId,
    version: packageJson.version || "1.0.0",
    description: packageJson.description || "",
    author: packageJson.author,
    category: hayPlugin.category,
    entry: hayPlugin.entry,
    capabilities: hayPlugin.capabilities || [],
  };

  return { manifest, pluginId };
}

/**
 * Validate a plugin ZIP, then stream it into `destDir`, a directory that does
 * not exist yet. Stops at the first byte over the size cap and removes the
 * partial extraction, whatever the entry headers declared.
 */
export async function extractPluginZip(
  zipBuffer: Buffer,
  destDir: string,
  maxBytes = MAX_UNCOMPRESSED_BYTES,
): Promise<void> {
  validatePluginZip(zipBuffer);

  let remaining = maxBytes;
  const countBytes = () =>
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        remaining -= chunk.length;
        callback(remaining < 0 ? new Error(TOO_LARGE_MESSAGE) : null, chunk);
      },
    });

  try {
    await fs.mkdir(destDir, { recursive: true });
    for (const entry of new AdmZip(zipBuffer).getEntries()) {
      const target = path.join(destDir, entry.entryName);
      if (entry.isDirectory) {
        await fs.mkdir(target, { recursive: true });
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await pipeline(
        Readable.from([entry.getCompressedData()], { objectMode: false }),
        entry.header.method === METHOD_DEFLATED ? createInflateRaw() : new PassThrough(),
        countBytes(),
        createWriteStream(target),
      );
    }
  } catch (error) {
    await fs.rm(destDir, { recursive: true, force: true });
    throw error;
  }
}
