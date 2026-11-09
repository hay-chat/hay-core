import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { config } from "@server/config/env";
import { AppDataSource } from "@server/database/data-source";
import { PluginRegistry } from "@server/entities/plugin-registry.entity";
import { PluginInstance } from "@server/entities/plugin-instance.entity";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { storageService } from "./storage.service";
import { pluginManagerService } from "./plugin-manager.service";
import { createLogger } from "@server/lib/logger";
import { extractPluginZip, validatePluginZip } from "@server/lib/plugin-archive";

const logger = createLogger("plugin-upload");

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

      // Validate ZIP structure
      const { manifest, pluginId } = validatePluginZip(zipBuffer);

      // Plugin ids are global: any existing row (core, another org's, or this
      // org's) blocks a new upload under the same id.
      const existing = await pluginRegistryRepository.findByPluginId(pluginId);

      if (existing) {
        const ownCustom =
          existing.sourceType === "custom" && existing.organizationId === req.organizationId;
        res.status(409).json({
          error: ownCustom
            ? `Plugin ${pluginId} already exists. Use PUT /v1/plugins/${pluginId} to update.`
            : `Plugin id ${pluginId} is not available. Choose a different package name.`,
        });
        return;
      }

      // Upload ZIP to storage
      const uploadResult = await storageService.uploadPluginZip({
        buffer: zipBuffer,
        originalName,
        pluginId,
        organizationId: req.organizationId,
        uploadedById: req.user.id,
      });

      // Extract to file system
      const extractPath = await this.extractPlugin(zipBuffer, pluginId, req.organizationId);

      // Register plugin in system
      await pluginManagerService.registerPlugin(extractPath, "custom", req.organizationId);

      // Update database with ZIP info
      const plugin = await pluginRegistryRepository.findCustomByPluginId(
        pluginId,
        req.organizationId,
      );

      if (plugin) {
        await AppDataSource.getRepository(PluginRegistry).update(plugin.id, {
          zipFilePath: uploadResult.upload.path,
          zipUploadId: uploadResult.upload.id,
          uploadedById: req.user.id,
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

      // Validate ZIP
      const { manifest, pluginId } = validatePluginZip(zipBuffer);

      // Validate pluginId matches URL parameter
      if (req.params.pluginId !== pluginId) {
        res.status(400).json({
          error: `Plugin ID mismatch. Expected ${req.params.pluginId}, got ${pluginId}`,
        });
        return;
      }

      // Check plugin exists
      const existing = await pluginRegistryRepository.findCustomByPluginId(
        pluginId,
        req.organizationId,
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
      if (runner.isRunning(req.organizationId, pluginId)) {
        await runner.stopWorker(req.organizationId, pluginId);
      }

      // Delete old ZIP from storage
      if (existing.zipUploadId) {
        await storageService.delete(existing.zipUploadId);
      }

      // Upload new ZIP
      const uploadResult = await storageService.uploadPluginZip({
        buffer: zipBuffer,
        originalName: req.file.originalname,
        pluginId,
        organizationId: req.organizationId,
        uploadedById: req.user.id,
      });

      // Extract to file system (overwrites old)
      const extractPath = await this.extractPlugin(zipBuffer, pluginId, req.organizationId);

      // Re-register plugin
      await pluginManagerService.registerPlugin(extractPath, "custom", req.organizationId);

      // Update database. The canonical manifest is already persisted by
      // registerPlugin above; here we only record the new ZIP/upload metadata.
      await AppDataSource.getRepository(PluginRegistry).update(existing.id, {
        zipFilePath: uploadResult.upload.path,
        zipUploadId: uploadResult.upload.id,
        uploadedById: req.user.id,
        uploadedAt: new Date(),
        version: manifest.version,
      });

      res.status(200).json({
        success: true,
        pluginId,
        name: manifest.name,
        version: manifest.version,
        message: `Plugin ${manifest.name} updated successfully`,
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
   * Extract plugin to file system
   */
  private async extractPlugin(
    zipBuffer: Buffer,
    pluginId: string,
    organizationId: string,
  ): Promise<string> {
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

    // Create organization directory if needed
    if (!fs.existsSync(orgDir)) {
      await fs.promises.mkdir(orgDir, { recursive: true });
    }

    // Remove existing plugin directory if present
    if (fs.existsSync(extractPath)) {
      await fs.promises.rm(extractPath, { recursive: true, force: true });
    }

    await extractPluginZip(zipBuffer, extractPath);

    return extractPath;
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
