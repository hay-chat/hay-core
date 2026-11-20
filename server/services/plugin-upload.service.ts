import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { config } from "@server/config/env";
import { AppDataSource } from "@server/database/data-source";
import { PluginRegistry } from "@server/entities/plugin-registry.entity";
import { PluginInstance } from "@server/entities/plugin-instance.entity";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { storageService } from "./storage.service";
import { pluginManagerService } from "./plugin-manager.service";
import { createLogger } from "@server/lib/logger";
import { extractPluginZip, validatePluginZip, withArchiveSlot } from "@server/lib/plugin-archive";
import { sha256Hex } from "@server/lib/plugin-pack";

const logger = createLogger("plugin-upload");

interface InstalledPlugin {
  path: string;
  /** Where the previous version was moved to, if there was one. */
  backup: string | null;
}

/** Most custom plugins one organization may have uploaded at a time. */
export const MAX_UPLOADED_PLUGINS_PER_ORG = 20;

const lockTails = new Map<string, Promise<void>>();

/** Run `work` after every earlier call with the same `key` has finished. */
async function withKeyedLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = lockTails.get(key) ?? Promise.resolve();
  const run = previous.then(work);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  lockTails.set(key, tail);
  try {
    return await run;
  } finally {
    if (lockTails.get(key) === tail) lockTails.delete(key);
  }
}

async function removeQuietly(target: string | null): Promise<void> {
  if (!target) return;
  try {
    await fs.promises.rm(target, { recursive: true, force: true });
  } catch (error) {
    logger.warn({ err: error, target }, "Could not remove plugin files");
  }
}

/**
 * When the uploader sends the archive's sha256 (`hay plugin pack` prints it),
 * the archive must match it, so a corrupted or swapped upload is refused.
 */
function assertArchiveDigest(req: Request, archive: Buffer): void {
  const expected = (req.body as { sha256?: unknown } | undefined)?.sha256;
  if (expected === undefined || expected === "") return;
  if (typeof expected !== "string" || sha256Hex(archive) !== expected.toLowerCase()) {
    throw new Error("Archive checksum does not match the sha256 that was sent");
  }
}

export class PluginUploadService {
  private pluginsDir: string;

  constructor() {
    this.pluginsDir = path.join(process.cwd(), "..", "plugins");
  }

  /**
   * Handle plugin upload
   */
  async handleUpload(req: Request, res: Response): Promise<void> {
    try {
      // Auth is handled by withAdminAuth middleware
      if (!req.user || !req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      // Check file exists
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const zipBuffer = req.file.buffer;
      const originalName = req.file.originalname;
      const organizationId = req.organizationId;
      const userId = req.user.id;

      // Validate ZIP structure
      assertArchiveDigest(req, zipBuffer);
      const { manifest, pluginId } = await withArchiveSlot(() => validatePluginZip(zipBuffer));

      // One upload at a time per organization (the cap) and per plugin id (the files).
      await withKeyedLock(`org:${organizationId}`, () =>
        withKeyedLock(`plugin:${pluginId}`, async () => {
          // Plugin ids are global: any existing row (core, another org's, or this
          // org's) blocks a new upload under the same id.
          const existing = await pluginRegistryRepository.findByPluginId(pluginId);

          if (existing) {
            const ownCustom =
              existing.sourceType === "custom" && existing.organizationId === organizationId;
            res.status(409).json({
              error: ownCustom
                ? `Plugin ${pluginId} already exists. Use PUT /v1/plugins/${pluginId} to update.`
                : `Plugin id ${pluginId} is not available. Choose a different package name.`,
            });
            return;
          }

          const owned = (await pluginRegistryRepository.findByOrganization(organizationId)).filter(
            (plugin) => plugin.sourceType === "custom",
          );
          if (owned.length >= MAX_UPLOADED_PLUGINS_PER_ORG) {
            res.status(409).json({
              error: `An organization can have at most ${MAX_UPLOADED_PLUGINS_PER_ORG} uploaded plugins. Delete one first.`,
            });
            return;
          }

          // Upload ZIP to storage
          const uploadResult = await storageService.uploadPluginZip({
            buffer: zipBuffer,
            originalName,
            pluginId,
            organizationId,
            uploadedById: userId,
          });

          // Extract to file system, then register
          const staged = await this.stagePlugin(zipBuffer);
          let installed: InstalledPlugin | undefined;
          try {
            installed = await this.installStaged(staged, pluginId, organizationId);
            await pluginManagerService.registerPlugin(installed.path, "custom", organizationId);
          } catch (error) {
            await this.rollbackInstall(staged, installed);
            await storageService.delete(uploadResult.upload.id).catch(() => undefined);
            throw error;
          }
          await removeQuietly(installed.backup);

          // Update database with ZIP info
          const plugin = await pluginRegistryRepository.findCustomByPluginId(
            pluginId,
            organizationId,
          );

          if (plugin) {
            await AppDataSource.getRepository(PluginRegistry).update(plugin.id, {
              zipFilePath: uploadResult.upload.path,
              zipUploadId: uploadResult.upload.id,
              uploadedById: userId,
              uploadedAt: new Date(),
            });
          }

          res.status(201).json({
            success: true,
            pluginId,
            name: manifest.name,
            version: manifest.version,
            message: `Plugin ${manifest.name} uploaded successfully`,
          });
        }),
      );
    } catch (error) {
      logger.error({ err: error }, "Plugin upload failed");
      const message = error instanceof Error ? error.message : "Upload failed";
      res.status(400).json({ error: message });
    }
  }

  /**
   * Handle plugin update
   */
  async handleUpdate(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const zipBuffer = req.file.buffer;
      const organizationId = req.organizationId;
      const userId = req.user.id;

      // Validate ZIP
      assertArchiveDigest(req, zipBuffer);
      const { manifest, pluginId } = await withArchiveSlot(() => validatePluginZip(zipBuffer));

      // Validate pluginId matches URL parameter
      if (req.params.pluginId !== pluginId) {
        res.status(400).json({
          error: `Plugin ID mismatch. Expected ${req.params.pluginId}, got ${pluginId}`,
        });
        return;
      }

      await withKeyedLock(`plugin:${pluginId}`, async () => {
        // Check plugin exists
        const existing = await pluginRegistryRepository.findCustomByPluginId(
          pluginId,
          organizationId,
        );

        if (!existing || existing.sourceType !== "custom") {
          res.status(404).json({
            error: `Custom plugin ${pluginId} not found for this organization`,
          });
          return;
        }

        // Stop running instances
        const { getPluginRunnerService } = await import("./plugin-runner.service");
        const runner = getPluginRunnerService();
        if (runner.isRunning(organizationId, pluginId)) {
          await runner.stopWorker(organizationId, pluginId);
        }

        // Store the new ZIP and extract it beside the live directory; the old
        // files stay in place until the new ones are ready to be swapped in.
        const uploadResult = await storageService.uploadPluginZip({
          buffer: zipBuffer,
          originalName: req.file!.originalname,
          pluginId,
          organizationId,
          uploadedById: userId,
        });

        let staged: string | undefined;
        let installed: InstalledPlugin | undefined;
        try {
          staged = await this.stagePlugin(zipBuffer);
          installed = await this.installStaged(staged, pluginId, organizationId);

          // Re-register plugin
          await pluginManagerService.registerPlugin(installed.path, "custom", organizationId);

          // Update database. The canonical manifest is already persisted by
          // registerPlugin above; here we only record the new ZIP/upload metadata.
          await AppDataSource.getRepository(PluginRegistry).update(existing.id, {
            zipFilePath: uploadResult.upload.path,
            zipUploadId: uploadResult.upload.id,
            uploadedById: userId,
            uploadedAt: new Date(),
            version: manifest.version,
          });
        } catch (error) {
          await this.rollbackInstall(staged, installed);
          await storageService.delete(uploadResult.upload.id).catch(() => undefined);
          throw error;
        }

        // Only now that the new version is live: drop the old files and ZIP.
        await removeQuietly(installed.backup);
        if (existing.zipUploadId) {
          await storageService.delete(existing.zipUploadId).catch((error: unknown) => {
            logger.warn({ err: error, pluginId }, "Could not delete the previous plugin ZIP");
          });
        }

        res.status(200).json({
          success: true,
          pluginId,
          name: manifest.name,
          version: manifest.version,
          message: `Plugin ${manifest.name} updated successfully`,
        });
      });
    } catch (error) {
      logger.error({ err: error }, "Plugin update failed");
      const message = error instanceof Error ? error.message : "Update failed";
      res.status(400).json({ error: message });
    }
  }

  /**
   * Handle plugin deletion
   */
  async handleDelete(req: Request, res: Response): Promise<void> {
    await withKeyedLock(`plugin:${req.params?.pluginId}`, () => this.deletePlugin(req, res));
  }

  private async deletePlugin(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { pluginId } = req.params;

      // Check plugin exists
      const plugin = await pluginRegistryRepository.findCustomByPluginId(
        pluginId,
        req.organizationId,
      );

      if (!plugin) {
        res.status(404).json({ error: `Plugin ${pluginId} not found` });
        return;
      }

      // Validate it's a custom plugin
      if (plugin.sourceType !== "custom") {
        res.status(403).json({ error: "Cannot delete core plugins" });
        return;
      }

      // Stop running instances
      const { getPluginRunnerService } = await import("./plugin-runner.service");
      const runner = getPluginRunnerService();
      if (runner.isRunning(req.organizationId, pluginId)) {
        await runner.stopWorker(req.organizationId, pluginId);
      }

      // Delete plugin instances
      const instances = await pluginInstanceRepository.findByPlugin(plugin.id);
      for (const instance of instances) {
        await AppDataSource.getRepository(PluginInstance).delete(instance.id);
      }

      // Delete ZIP from storage
      if (plugin.zipUploadId) {
        await storageService.delete(plugin.zipUploadId);
      }

      // Delete extracted directory
      const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);
      if (fs.existsSync(pluginPath)) {
        await fs.promises.rm(pluginPath, { recursive: true, force: true });
      }

      // Delete from database
      await pluginRegistryRepository.deleteCustomPlugin(pluginId, req.organizationId);

      // Remove from in-memory registry
      pluginManagerService.registry.delete(pluginId);

      res.status(200).json({
        success: true,
        message: `Plugin ${pluginId} deleted successfully`,
      });
    } catch (error) {
      logger.error({ err: error }, "Plugin deletion failed");
      const message = error instanceof Error ? error.message : "Deletion failed";
      res.status(400).json({ error: message });
    }
  }

  /**
   * Extract the archive into a fresh directory inside `custom`, the one writable
   * location under the plugins directory and the filesystem the install renames within.
   * Plugin scans skip dot directories. Returns the staged path.
   */
  private async stagePlugin(zipBuffer: Buffer): Promise<string> {
    const incomingRoot = path.resolve(this.pluginsDir, "custom", ".incoming");
    await fs.promises.mkdir(incomingRoot, { recursive: true });
    const staged = path.join(incomingRoot, randomUUID());
    await withArchiveSlot(() => extractPluginZip(zipBuffer, staged));
    return staged;
  }

  /**
   * Move a staged directory into `custom/<org>/<pluginId>`. A directory already
   * there is renamed to `backup`, not deleted; the caller removes it once the
   * new version is registered.
   */
  private async installStaged(
    staged: string,
    pluginId: string,
    organizationId: string,
  ): Promise<InstalledPlugin> {
    const customRoot = path.resolve(this.pluginsDir, "custom");
    const orgDir = path.resolve(customRoot, organizationId);
    const extractPath = path.resolve(orgDir, pluginId);

    const customRootWithSep = `${customRoot}${path.sep}`;
    if (!orgDir.startsWith(customRootWithSep)) {
      throw new Error("Invalid organization path");
    }
    if (!extractPath.startsWith(customRootWithSep)) {
      throw new Error("Invalid plugin path");
    }

    await fs.promises.mkdir(orgDir, { recursive: true });
    const backup = path.join(path.dirname(staged), `${randomUUID()}.previous`);
    let hadPrevious = true;
    try {
      await fs.promises.rename(extractPath, backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hadPrevious = false;
    }
    try {
      await fs.promises.rename(staged, extractPath);
    } catch (error) {
      if (hadPrevious) await fs.promises.rename(backup, extractPath).catch(() => undefined);
      throw error;
    }
    return { path: extractPath, backup: hadPrevious ? backup : null };
  }

  /** Undo installStaged: put the previous directory back, or drop what was staged. */
  private async rollbackInstall(
    staged: string | undefined,
    installed: InstalledPlugin | undefined,
  ): Promise<void> {
    if (installed) {
      await removeQuietly(installed.path);
      if (installed.backup) {
        await fs.promises.rename(installed.backup, installed.path).catch((error: unknown) => {
          logger.error({ err: error }, "Could not restore the previous plugin files");
        });
      }
    } else if (staged) {
      await removeQuietly(staged);
    }
  }
}

export const pluginUploadService = new PluginUploadService();

/**
 * Reject plugin uploads/updates up front (before the body is buffered) when
 * the server does not accept organization-supplied plugin code.
 */
export function requireCustomPluginsAllowed(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!config.plugins.allowCustomPlugins) {
    res.status(403).json({ error: "Custom plugins are disabled on this server" });
    return;
  }
  next();
}

/**
 * Route-level error handler for the multer upload middleware: turn limit and
 * file-filter errors into 4xx responses instead of unhandled 500s.
 */
export function handlePluginUploadError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
}
