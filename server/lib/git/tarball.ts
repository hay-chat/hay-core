import { createGunzip } from "zlib";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import fs from "fs/promises";
import path from "path";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("tarball");

/**
 * Extract a tar.gz buffer to a directory.
 *
 * GitHub tarballs contain a single top-level directory (e.g., "owner-repo-sha/").
 * This extracts the contents of that directory directly into `destDir`,
 * stripping the first path component.
 */
export async function extractTarball(buffer: Buffer, destDir: string): Promise<void> {
  // Dynamic import — tar is available as a transitive dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tar = require("tar") as {
    extract: (opts: { cwd: string; strip: number }) => NodeJS.WritableStream;
  };

  // Ensure destination exists
  await fs.mkdir(destDir, { recursive: true });

  // Create a readable stream from the buffer
  const stream = Readable.from(buffer);

  // Extract, stripping the first directory component
  // GitHub tarballs always have a single root dir like "owner-repo-commitsha/"
  await pipeline(
    stream,
    createGunzip(),
    tar.extract({
      cwd: destDir,
      strip: 1, // Remove the top-level directory
    }),
  );

  logger.info({ destDir }, "Tarball extracted");
}

/**
 * Validate a tar.gz buffer contains a valid Hay plugin.
 * Extracts to a temp dir, checks for package.json with hay-plugin field,
 * then cleans up.
 *
 * Returns the parsed manifest and pluginId.
 */
export async function validateTarball(buffer: Buffer): Promise<{
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    entry: string;
    capabilities: string[];
  };
  pluginId: string;
}> {
  const os = await import("os");
  const tmpDir = path.join(os.tmpdir(), `hay-plugin-validate-${Date.now()}`);

  try {
    await extractTarball(buffer, tmpDir);

    // Read package.json
    const packagePath = path.join(tmpDir, "package.json");
    const packageContent = await fs.readFile(packagePath, "utf-8");
    const packageJson = JSON.parse(packageContent);

    // Validate hay-plugin field
    if (!packageJson["hay-plugin"]) {
      throw new Error("package.json must contain a 'hay-plugin' field");
    }

    const hayPlugin = packageJson["hay-plugin"];

    if (!packageJson.name) {
      throw new Error("package.json missing required 'name' field");
    }

    if (!hayPlugin.entry) {
      throw new Error("hay-plugin missing required 'entry' field");
    }

    const pluginId = packageJson.name;
    if (!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(pluginId)) {
      throw new Error(
        "Plugin ID (package name) must be a valid npm package name (lowercase letters, numbers, hyphens, optional scope)",
      );
    }

    const manifest = {
      id: pluginId,
      name: hayPlugin.displayName || pluginId,
      version: packageJson.version || "1.0.0",
      description: packageJson.description || "",
      entry: hayPlugin.entry,
      capabilities: hayPlugin.capabilities || [],
    };

    return { manifest, pluginId };
  } finally {
    // Clean up temp dir
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
