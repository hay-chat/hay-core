import { Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("plugin-asset");

/**
 * Type guard for Node.js filesystem errors that carry an OS error code (e.g. "ENOENT").
 */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Plugin ids as they appear in asset URLs (no slashes, no traversal). */
const PLUGIN_NAME_PATTERN = /^[@a-z0-9._-]+$/;

/** Files never rendered as documents on the API origin. */
const INERT_EXTENSIONS = new Set([".html", ".htm", ".xhtml", ".xml"]);

export function isValidPluginName(pluginName: unknown): pluginName is string {
  return (
    typeof pluginName === "string" &&
    PLUGIN_NAME_PATTERN.test(pluginName) &&
    pluginName !== "." &&
    pluginName !== ".."
  );
}

/**
 * Resolve `relativePath` inside `baseDir`, or null when it would land outside
 * it (including through a symlink) or the file does not exist.
 */
export async function resolveWithin(baseDir: string, relativePath: string): Promise<string | null> {
  const isInside = (base: string, target: string): boolean => {
    const rel = path.relative(base, target);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  };

  const candidate = path.resolve(baseDir, relativePath);
  if (!isInside(baseDir, candidate)) return null;

  try {
    const [realBase, realCandidate] = await Promise.all([
      fs.realpath(baseDir),
      fs.realpath(candidate),
    ]);
    return isInside(realBase, realCandidate) ? realCandidate : null;
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return null;
    }
    throw error;
  }
}

function pluginDirFor(pluginPath: string): string {
  return path.join(process.cwd(), "..", "plugins", pluginPath);
}

/**
 * Headers for files served from a plugin directory: no MIME sniffing, a
 * sandbox for anything opened as a document (e.g. an SVG), and document types
 * are downloaded rather than rendered.
 */
function setFileSafetyHeaders(res: Response, filePath: string): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  if (INERT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    res.setHeader("Content-Disposition", "attachment");
  }
}

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
   * Plugin thumbnail filenames in priority order (svg > png > jpg) with the
   * Content-Type each should be served with.
   */
  private static readonly thumbnailCandidates: ReadonlyArray<{
    file: string;
    contentType: string;
  }> = [
    { file: "thumbnail.svg", contentType: "image/svg+xml" },
    { file: "thumbnail.png", contentType: "image/png" },
    { file: "thumbnail.jpg", contentType: "image/jpeg" },
  ];

  /**
   * Read the first thumbnail that exists in the plugin directory, honouring the
   * svg > png > jpg priority order. Returns null if none exist.
   */
  private async readThumbnail(
    pluginDir: string,
  ): Promise<{ content: Buffer; contentType: string } | null> {
    for (const candidate of PluginAssetService.thumbnailCandidates) {
      try {
        const content = await fs.readFile(path.join(pluginDir, candidate.file));
        return { content, contentType: candidate.contentType };
      } catch (error) {
        // Missing file → try the next candidate; anything else is a real error.
        if (isErrnoException(error) && error.code === "ENOENT") continue;
        throw error;
      }
    }
    return null;
  }

  /**
   * Serve a plugin thumbnail. Resolves the image as svg > png > jpg so a plugin
   * can ship any of them; an SVG is preferred for crisp scaling.
   */
  async serveThumbnail(req: Request, res: Response): Promise<void> {
    const { pluginName } = req.params;
    if (!isValidPluginName(pluginName)) {
      res.status(404).json({ error: "Thumbnail not found" });
      return;
    }
    const cacheKey = `${pluginName}/thumbnail`;

    // Check cache first
    if (this.assetCache.has(cacheKey)) {
      const cached = this.assetCache.get(cacheKey)!;

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === cached.etag) {
        res.status(304).end();
        return;
      }

      setFileSafetyHeaders(res, cacheKey);
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("ETag", cached.etag);
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
      res.setHeader("Last-Modified", cached.lastModified.toUTCString());
      res.send(cached.content);
      return;
    }

    // Only registered plugins have thumbnails served.
    const plugin = await pluginRegistryRepository.findByPluginId(pluginName);
    if (!plugin) {
      res.status(404).json({ error: "Thumbnail not found" });
      return;
    }
    const pluginDir = pluginDirFor(plugin.pluginPath);

    try {
      const thumbnail = await this.readThumbnail(pluginDir);
      if (!thumbnail) {
        res.status(404).json({ error: "Thumbnail not found" });
        return;
      }

      const { content, contentType } = thumbnail;
      const etag = this.generateETag(content);
      const lastModified = new Date();

      // Cache the thumbnail
      this.assetCache.set(cacheKey, { content, contentType, etag, lastModified });

      // Set cache timeout (24 hours for thumbnails)
      setTimeout(
        () => {
          this.assetCache.delete(cacheKey);
        },
        24 * 60 * 60 * 1000,
      ).unref();

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      setFileSafetyHeaders(res, cacheKey);
      res.setHeader("Content-Type", contentType);
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
      res.setHeader("Last-Modified", lastModified.toUTCString());
      res.send(content);
    } catch (error) {
      logger.error({ err: error, pluginName }, "Failed to serve plugin thumbnail");
      res.status(404).json({ error: "Thumbnail not found" });
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
    if (!isValidPluginName(pluginName)) {
      res.status(404).json({ error: "Plugin not found" });
      return;
    }
    const cacheKey = `${pluginName}/public/${filePath}`;

    // Check cache first
    if (this.assetCache.has(cacheKey)) {
      const cached = this.assetCache.get(cacheKey)!;

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === cached.etag) {
        res.status(304).end();
        return;
      }

      setFileSafetyHeaders(res, cacheKey);
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

    const publicDir = path.join(pluginDirFor(plugin.pluginPath), "public");

    try {
      const fullPath = await resolveWithin(publicDir, filePath);
      if (!fullPath) {
        res.status(404).json({ error: "File not found" });
        return;
      }

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
      }, this.cacheTimeout).unref();

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      setFileSafetyHeaders(res, fullPath);
      res.setHeader("Content-Type", contentType);
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Last-Modified", lastModified.toUTCString());
      res.send(content);
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        res.status(404).json({ error: "File not found" });
      } else {
        logger.error({ err: error, filePath, pluginName }, "Failed to serve public file");
        res.status(500).json({ error: "Failed to load file" });
      }
    }
  }

  /**
   * Serve UI asset files (from dist/ directory) with authentication
   * Only allows whitelisted file types for security
   */
  async serveUIAsset(req: Request, res: Response): Promise<void> {
    const { pluginName, assetPath } = req.params;
    if (!isValidPluginName(pluginName)) {
      res.status(404).json({ error: "Plugin not found" });
      return;
    }
    const cacheKey = `${pluginName}/ui/${assetPath}`;

    // Security: Whitelist allowed file types
    const allowedExtensions = [
      ".js",
      ".mjs",
      ".css",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
      ".webp",
    ];
    const ext = path.extname(assetPath).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      res.status(403).json({ error: "File type not allowed" });
      return;
    }

    // Check cache first
    if (this.assetCache.has(cacheKey)) {
      const cached = this.assetCache.get(cacheKey)!;

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === cached.etag) {
        res.status(304).end();
        return;
      }

      setFileSafetyHeaders(res, cacheKey);
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

    const distDir = path.join(pluginDirFor(plugin.pluginPath), "dist");

    try {
      const fullPath = await resolveWithin(distDir, assetPath);
      if (!fullPath) {
        res.status(404).json({ error: "File not found" });
        return;
      }

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
      }, this.cacheTimeout).unref();

      // Check if-none-match header for etag
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      setFileSafetyHeaders(res, fullPath);
      res.setHeader("Content-Type", contentType);
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Last-Modified", lastModified.toUTCString());
      res.send(content);
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        res.status(404).json({ error: "File not found" });
      } else {
        logger.error({ err: error, assetPath, pluginName }, "Failed to serve UI asset");
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
