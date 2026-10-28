import express from "express";
import path from "path";
import type { RequestHandler } from "express";

/** widget.js is the loader every embed points at: short, so deploys reach shoppers fast. */
export const LOADER_CACHE_CONTROL = "public, max-age=300";
/** assets/ holds content-hashed chunks (chat, locales): a new build means new names. */
export const HASHED_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Static serving for the webchat build (`webchat/dist`), mounted at /v1/webchat.
 * Every file is loadable from any origin: the loader imports the chat chunk as
 * a cross-origin module, which needs the CORS header.
 */
export function webchatStatic(webchatDir: string): RequestHandler {
  const assetsDir = path.join(webchatDir, "assets") + path.sep;
  return express.static(webchatDir, {
    etag: true,
    lastModified: true,
    cacheControl: false, // set per file below
    setHeaders: (res, filePath) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Cache-Control",
        filePath.startsWith(assetsDir) ? HASHED_CACHE_CONTROL : LOADER_CACHE_CONTROL,
      );
    },
  });
}
