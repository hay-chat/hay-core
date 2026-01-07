import { Request, Response } from "express";
import AdmZip from "adm-zip";
import path from "path";
import fs from "fs";
import Ajv from "ajv";
import { AppDataSource } from "@server/database/data-source";
import { PluginRegistry } from "@server/entities/plugin-registry.entity";
import { PluginInstance } from "@server/entities/plugin-instance.entity";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { storageService } from "./storage.service";
import { pluginManagerService } from "./plugin-manager.service";

export class PluginUploadService {
  private ajv: Ajv;
  private manifestSchema: any;
  private pluginsDir: string;

  constructor() {
    this.ajv = new Ajv({ allErrors: true });
    this.pluginsDir = path.join(process.cwd(), "..", "plugins");
    this.loadManifestSchema();
  }

  private async loadManifestSchema() {
    try {
      const schemaPath = path.join(this.pluginsDir, "base", "plugin-manifest.schema.json");
      const schemaContent = await fs.promises.readFile(schemaPath, "utf-8");
      this.manifestSchema = JSON.parse(schemaContent);
      console.log("✅ Loaded plugin manifest schema for validation");
    } catch (error) {
      console.warn("⚠️  Could not load plugin manifest schema:", error);
    }
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
      const { manifest, pluginId } = await this.validateZipStructure(zipBuffer);

      // Check if plugin already exists
      const existing = await pluginRegistryRepository.findCustomByPluginId(
        pluginId,
        req.organizationId,
      );

      if (existing) {
        res.status(409).json({
          error: `Plugin ${pluginId} already exists. Use PUT /v1/plugins/${pluginId} to update.`,
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
        } as any);
      }

      res.status(201).json({
        success: true,
        pluginId,
        name: manifest.name,
        version: manifest.version,
        message: `Plugin ${manifest.name} uploaded successfully`,
      });
    } catch (error) {
      console.error("Plugin upload failed:", error);
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
      const { manifest, pluginId } = await this.validateZipStructure(zipBuffer);

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
      const { getPluginRunnerV2Service } = await import("./plugin-runner-v2.service");
      const runnerV2 = getPluginRunnerV2Service();
      if (runnerV2.isRunning(req.organizationId, pluginId)) {
        await runnerV2.stopWorker(req.organizationId, pluginId);
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

      // Update database
      await AppDataSource.getRepository(PluginRegistry).update(existing.id, {
        zipFilePath: uploadResult.upload.path,
        zipUploadId: uploadResult.upload.id,
        uploadedById: req.user.id,
        uploadedAt: new Date(),
        version: manifest.version,
        manifest: manifest as any,
      } as any);

      res.status(200).json({
        success: true,
        pluginId,
        name: manifest.name,
        version: manifest.version,
        message: `Plugin ${manifest.name} updated successfully`,
      });
    } catch (error) {
      console.error("Plugin update failed:", error);
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
      const { getPluginRunnerV2Service } = await import("./plugin-runner-v2.service");
      const runnerV2 = getPluginRunnerV2Service();
      if (runnerV2.isRunning(req.organizationId, pluginId)) {
        await runnerV2.stopWorker(req.organizationId, pluginId);
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
      console.error("Plugin deletion failed:", error);
      const message = error instanceof Error ? error.message : "Deletion failed";
      res.status(400).json({ error: message });
    }
  }

  /**
   * Validate ZIP structure and manifest
   */
  private async validateZipStructure(zipBuffer: Buffer): Promise<{
    manifest: any;
    pluginId: string;
  }> {
    try {
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();

      // Security: Check for zip bombs
      let totalUncompressedSize = 0;
      for (const entry of zipEntries) {
        totalUncompressedSize += entry.header.size;

        // Prevent zip bombs (uncompressed > 500MB)
        if (totalUncompressedSize > 500 * 1024 * 1024) {
          throw new Error("ZIP file exceeds maximum uncompressed size (500MB)");
        }

        // Prevent path traversal
        const normalizedPath = path.normalize(entry.entryName);
        if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
          throw new Error(`Invalid file path in ZIP: ${entry.entryName}`);
        }
      }

      // Find manifest.json
      const manifestEntry = zipEntries.find(
        (e) => e.entryName === "manifest.json" || e.entryName.endsWith("/manifest.json"),
      );

      if (!manifestEntry) {
        throw new Error("manifest.json not found in ZIP root");
      }

      // Parse manifest
      const manifestContent = zip.readAsText(manifestEntry);
      const manifest = JSON.parse(manifestContent);

      // Validate against schema
      if (this.manifestSchema) {
        const validate = this.ajv.compile(this.manifestSchema);
        const valid = validate(manifest);

        if (!valid) {
          throw new Error(`Invalid manifest: ${JSON.stringify(validate.errors)}`);
        }
      }

      // Validate required fields
      if (!manifest.id || !manifest.name || !manifest.version) {
        throw new Error("Manifest missing required fields (id, name, version)");
      }

      // Validate plugin ID format
      if (!/^[a-z0-9-]+$/.test(manifest.id)) {
        throw new Error("Plugin ID must contain only lowercase letters, numbers, and hyphens");
      }

      return { manifest, pluginId: manifest.id };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Invalid ZIP file structure");
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
    const extractPath = path.join(this.pluginsDir, "custom", organizationId, pluginId);

    // Create organization directory if needed
    const orgDir = path.join(this.pluginsDir, "custom", organizationId);
    if (!fs.existsSync(orgDir)) {
      await fs.promises.mkdir(orgDir, { recursive: true });
    }

    // Remove existing plugin directory if present
    if (fs.existsSync(extractPath)) {
      await fs.promises.rm(extractPath, { recursive: true, force: true });
    }

    // Extract ZIP
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(extractPath, true);

    return extractPath;
  }
}

export const pluginUploadService = new PluginUploadService();
