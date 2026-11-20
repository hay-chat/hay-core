import { createGunzip } from "zlib";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createLogger } from "@server/lib/logger";
import { describePackedPlugin, type UploadedPluginManifest } from "@server/lib/plugin-archive";
import { copyPackedFiles, verifyPackedTree } from "@server/lib/plugin-pack";

const logger = createLogger("tarball");

/** Caps for an extracted plugin tarball. */
export const MAX_TARBALL_UNPACKED_BYTES = 500 * 1024 * 1024;
export const MAX_TARBALL_ENTRIES = 10_000;

/** Only regular files and directories are extracted; links and devices are rejected. */
const ALLOWED_ENTRY_TYPES = new Set(["File", "OldFile", "ContiguousFile", "Directory"]);

interface TarEntry {
  type: string;
  size?: number;
}

interface TarModule {
  extract: (opts: {
    cwd: string;
    strip: number;
    preserveOwner: boolean;
    filter: (entryPath: string, entry: TarEntry) => boolean;
  }) => NodeJS.WritableStream;
}

function isUnsafeEntryPath(entryPath: string): boolean {
  if (entryPath.includes("\\") || entryPath.includes("\0") || path.isAbsolute(entryPath)) {
    return true;
  }
  return entryPath.split("/").includes("..");
}

/** Fails the stream once more than `maxBytes` have passed through. */
function byteLimit(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        callback(new Error("Archive exceeds maximum unpacked size"));
        return;
      }
      callback(null, chunk);
    },
  });
}

/**
 * Extract a tar.gz buffer to a directory, as it is.
 *
 * GitHub tarballs contain a single top-level directory (e.g., "owner-repo-sha/").
 * This extracts the contents of that directory directly into `destDir`,
 * stripping the first path component.
 *
 * Only regular files and directories with relative, non-traversing paths are
 * accepted, within entry-count and unpacked-size caps; anything else fails
 * the extraction and removes `destDir`.
 */
async function extractRawTarball(buffer: Buffer, destDir: string): Promise<void> {
  // Dynamic import — tar is available as a transitive dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tar = require("tar") as TarModule;

  // Ensure destination exists
  await fs.mkdir(destDir, { recursive: true });

  let entries = 0;
  let declaredBytes = 0;
  let violation: string | null = null;

  const filter = (entryPath: string, entry: TarEntry): boolean => {
    if (violation) return false;
    entries += 1;
    declaredBytes += entry.size ?? 0;
    if (!ALLOWED_ENTRY_TYPES.has(entry.type)) {
      violation = `Unsupported entry type ${entry.type} in archive: ${entryPath}`;
    } else if (isUnsafeEntryPath(entryPath)) {
      violation = `Invalid file path in archive: ${entryPath}`;
    } else if (entries > MAX_TARBALL_ENTRIES) {
      violation = `Archive has too many entries (max ${MAX_TARBALL_ENTRIES})`;
    } else if (declaredBytes > MAX_TARBALL_UNPACKED_BYTES) {
      violation = "Archive exceeds maximum unpacked size";
    }
    return violation === null;
  };

  try {
    // Extract, stripping the first directory component
    // GitHub tarballs always have a single root dir like "owner-repo-commitsha/"
    await pipeline(
      Readable.from(buffer),
      createGunzip(),
      // Tar headers and padding add overhead on top of file contents.
      byteLimit(MAX_TARBALL_UNPACKED_BYTES + 64 * 1024 * 1024),
      tar.extract({ cwd: destDir, strip: 1, preserveOwner: false, filter }),
    );
    if (violation) {
      throw new Error(violation);
    }
  } catch (error) {
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  logger.info({ destDir }, "Tarball extracted");
}

/**
 * Install the plugin pack held by a tar.gz buffer into `destDir`, which must
 * not exist yet. The repository must contain a `hay-pack.json` (see
 * `hay plugin pack`); only the files it lists are copied, each checked against
 * its checksum, and `destDir` is removed again on any failure.
 */
export async function extractTarball(buffer: Buffer, destDir: string): Promise<void> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "hay-plugin-extract-"));
  try {
    await extractRawTarball(buffer, path.join(staging, "repo"));
    await copyPackedFiles(path.join(staging, "repo"), destDir);
  } catch (error) {
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Validate a tar.gz buffer contains a valid, packed Hay plugin: it extracts to
 * a fresh temp dir, its manifest and pack are checked, and the dir is removed.
 *
 * Returns the parsed manifest and pluginId.
 */
export async function validateTarball(buffer: Buffer): Promise<{
  manifest: UploadedPluginManifest;
  pluginId: string;
}> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hay-plugin-validate-"));

  try {
    const dest = path.join(tmpDir, "plugin");
    await extractTarball(buffer, dest);
    const pack = await verifyPackedTree(dest);
    const packageContent = await fs.readFile(path.join(dest, "package.json"), "utf-8");
    return describePackedPlugin(packageContent, pack);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
