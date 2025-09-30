import { Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import type { PublicAsset, HayPluginManifest } from "@server/types/plugin.types";

interface AssetCache {
  content: string | Buffer;
  contentType: string;
  etag: string;
  lastModified: Date;
}

export class PluginAssetService {
  private assetCache = new Map<string, AssetCache>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  /**
   * Get public assets from a plugin
   */
  async getPluginAssets(pluginId: string): Promise<PublicAsset[]> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;
    if (!manifest.capabilities?.chat_connector?.publicAssets) {
      return [];
    }

    const pluginDir = path.join(
      process.cwd(),
      "..",
      "plugins",
      plugin.pluginPath,  // Use the actual directory name stored in DB
    );
    const assets: PublicAsset[] = [];

    for (const assetDef of manifest.capabilities.chat_connector.publicAssets) {
      const filePath = path.join(pluginDir, assetDef.file);
      try {
        const content = await fs.readFile(filePath);
        const contentType = this.getContentType(assetDef.type);

        assets.push({
          path: assetDef.path,
          content,
          contentType,
          cache: true,
        });
      } catch (error) {
        console.error(
          `Failed to load asset ${assetDef.file} for plugin ${plugin.pluginId}:`,
          error,
        );
      }
    }

    return assets;
  }

  /**
   * Serve a plugin thumbnail
   */
  async serveThumbnail(req: Request, res: Response): Promise<void> {
    const { pluginName } = req.params;
    const cacheKey = `${pluginName}/thumbnail.jpg`;

    // Check cache first
    if (this.assetCache.has(cacheKey)) {
      const cached = this.assetCache.get(cacheKey)!;

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === cached.etag) {
        res.status(304).end();
        return;
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("ETag", cached.etag);
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
      res.setHeader("Last-Modified", cached.lastModified.toUTCString());
      res.send(cached.content);
      return;
    }

    // Find the plugin to get the correct directory path
    const plugin = await pluginRegistryRepository.findByPluginId(pluginName);
    if (!plugin) {
      // If no plugin found, fallback to using pluginName as directory (for backward compatibility)
      const pluginDir = path.join(process.cwd(), "..", "plugins", pluginName);
      const thumbnailPath = path.join(pluginDir, "thumbnail.jpg");
      
      try {
        const content = await fs.readFile(thumbnailPath);
        const etag = this.generateETag(content);
        const lastModified = new Date();

        // Cache the thumbnail
        this.assetCache.set(cacheKey, {
          content,
          contentType: "image/jpeg",
          etag,
          lastModified,
        });

        // Set cache timeout (24 hours for thumbnails)
        setTimeout(
          () => {
            this.assetCache.delete(cacheKey);
          },
          24 * 60 * 60 * 1000,
        );

        // Check if-none-match header for etag
        if (req.headers["if-none-match"] === etag) {
          res.status(304).end();
          return;
        }

        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Last-Modified", lastModified.toUTCString());
        res.send(content);
        return;
      } catch (error) {
        console.warn(`Thumbnail not found for plugin ${pluginName}:`, error);
        res.status(404).json({ error: "Thumbnail not found" });
        return;
      }
    }
    
    // Build path to plugin thumbnail using the stored pluginPath
    const pluginDir = path.join(
      process.cwd(),
      "..",
      "plugins",
      plugin.pluginPath  // Use the actual directory name stored in DB
    );
    const thumbnailPath = path.join(pluginDir, "thumbnail.jpg");

    try {
      const content = await fs.readFile(thumbnailPath);
      const etag = this.generateETag(content);
      const lastModified = new Date();

      // Cache the thumbnail
      this.assetCache.set(cacheKey, {
        content,
        contentType: "image/jpeg",
        etag,
        lastModified,
      });

      // Set cache timeout (24 hours for thumbnails)
      setTimeout(
        () => {
          this.assetCache.delete(cacheKey);
        },
        24 * 60 * 60 * 1000,
      );

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
      res.setHeader("Last-Modified", lastModified.toUTCString());
      res.send(content);
    } catch (error) {
      // If thumbnail doesn't exist, return 404
      console.warn(`Thumbnail not found for plugin ${pluginName}:`, error);
      res.status(404).json({ error: "Thumbnail not found" });
    }
  }

  /**
   * Serve a plugin asset
   */
  async serveAsset(req: Request, res: Response): Promise<void> {
    const { pluginName, assetPath } = req.params;
    const cacheKey = `${pluginName}/${assetPath}`;

    // Skip cache for widget.js in development
    const isDevelopment = process.env.NODE_ENV !== "production";
    const isWidgetJs = assetPath === "widget.js";
    const shouldUseCache = !isDevelopment || !isWidgetJs;

    // Check cache first (unless it's widget.js in development)
    if (shouldUseCache && this.assetCache.has(cacheKey)) {
      const cached = this.assetCache.get(cacheKey)!;

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === cached.etag) {
        res.status(304).end();
        return;
      }

      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("ETag", cached.etag);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Last-Modified", cached.lastModified.toUTCString());
      res.send(cached.content);
      return;
    }

    // Find the plugin
    const plugin = await pluginRegistryRepository.findByPluginId(pluginName);

    if (!plugin) {
      res.status(404).json({ error: "Plugin not found" });
      return;
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const assetDef = manifest.capabilities?.chat_connector?.publicAssets?.find(
      (a) => a.path === assetPath,
    );

    if (!assetDef) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const pluginDir = path.join(
      process.cwd(),
      "..",
      "plugins",
      plugin.pluginPath,  // Use the actual directory name stored in DB
    );
    const filePath = path.join(pluginDir, assetDef.file);

    try {
      const content = await fs.readFile(filePath);
      const contentType = this.getContentType(assetDef.type);
      const etag = this.generateETag(content);
      const lastModified = new Date();

      // Cache the asset (unless it's widget.js in development)
      if (shouldUseCache) {
        this.assetCache.set(cacheKey, {
          content,
          contentType,
          etag,
          lastModified,
        });

        // Set cache timeout
        setTimeout(() => {
          this.assetCache.delete(cacheKey);
        }, this.cacheTimeout);
      }

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Last-Modified", lastModified.toUTCString());
      res.send(content);
    } catch (error) {
      console.error(`Failed to serve asset ${assetPath} for plugin ${pluginName}:`, error);
      res.status(500).json({ error: "Failed to load asset" });
    }
  }

  /**
   * Get content type from asset type
   */
  private getContentType(type: string): string {
    switch (type) {
      case "script":
        return "application/javascript";
      case "stylesheet":
        return "text/css";
      case "image":
        return "image/png";
      default:
        return "application/octet-stream";
    }
  }

  /**
   * Generate ETag for content
   */
  private generateETag(content: Buffer | string): string {
    const crypto = require("crypto");
    const hash = crypto.createHash("md5");
    hash.update(content);
    return `"${hash.digest("hex")}"`;
  }

  /**
   * Clear asset cache
   */
  clearCache(): void {
    this.assetCache.clear();
  }

  /**
   * Clear cache for specific plugin
   */
  clearPluginCache(pluginName: string): void {
    for (const key of this.assetCache.keys()) {
      if (key.startsWith(`${pluginName}/`)) {
        this.assetCache.delete(key);
      }
    }
  }

  /**
   * Serve any file from plugin's public directory
   */
  async servePublicFile(req: Request, res: Response): Promise<void> {
    const { pluginName, filePath } = req.params;
    const cacheKey = `${pluginName}/public/${filePath}`;

    // Check cache first
    if (this.assetCache.has(cacheKey)) {
      const cached = this.assetCache.get(cacheKey)!;

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === cached.etag) {
        res.status(304).end();
        return;
      }

      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("ETag", cached.etag);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Last-Modified", cached.lastModified.toUTCString());
      res.send(cached.content);
      return;
    }

    // Find the plugin
    const plugin = await pluginRegistryRepository.findByPluginId(pluginName);
    
    if (!plugin) {
      res.status(404).json({ error: "Plugin not found" });
      return;
    }

    // Sanitize the file path to prevent directory traversal
    const sanitizedPath = filePath.replace(/\.\./g, "");
    
    // Build path to plugin public directory
    const pluginDir = path.join(
      process.cwd(),
      "..",
      "plugins",
      plugin.pluginPath,  // Use the actual directory name stored in DB
    );
    const publicDir = path.join(pluginDir, "public");
    const fullPath = path.join(publicDir, sanitizedPath);

    // Ensure the path is within the public directory
    if (!fullPath.startsWith(publicDir)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    try {
      const content = await fs.readFile(fullPath);
      const contentType = this.getContentTypeFromPath(fullPath);
      const etag = this.generateETag(content);
      const lastModified = new Date();

      // Cache the file
      this.assetCache.set(cacheKey, {
        content,
        contentType,
        etag,
        lastModified,
      });

      // Set cache timeout
      setTimeout(() => {
        this.assetCache.delete(cacheKey);
      }, this.cacheTimeout);

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Last-Modified", lastModified.toUTCString());
      res.send(content);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        res.status(404).json({ error: "File not found" });
      } else {
        console.error(`Failed to serve public file ${filePath} for plugin ${pluginName}:`, error);
        res.status(500).json({ error: "Failed to load file" });
      }
    }
  }

  /**
   * Get content type from file path
   */
  private getContentTypeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".js": "application/javascript",
      ".mjs": "application/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".htm": "text/html",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".txt": "text/plain",
      ".xml": "application/xml",
      ".pdf": "application/pdf",
      ".zip": "application/zip",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
    };

    return mimeTypes[ext] || "application/octet-stream";
  }
}

export const pluginAssetService = new PluginAssetService();
