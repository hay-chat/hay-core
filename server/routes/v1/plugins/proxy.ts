import { Router, type Request, type Response } from "express";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginInstanceManagerService } from "@server/services/plugin-instance-manager.service";
import { organizationRepository } from "@server/repositories/organization.repository";
import { isValidUuid } from "@server/lib/validation/uuid";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("plugin-proxy");

const router = Router();

/**
 * Proxy all requests to plugin workers
 * URL pattern: /v1/plugins/:pluginId/*
 *
 * Plugin IDs are plain strings without slashes (e.g., hay-channel-whatsapp-twilio).
 * Match groups: [1] = pluginId, [2] = remaining path
 */
router.all(/^\/([^/]+)\/(.*)?$/, async (req: Request, res: Response) => {
  try {
    const pluginId = req.params[0];
    const path = req.params[1] ? `/${req.params[1]}` : "";

    logger.debug({ method: req.method, path: req.path, pluginId }, "Proxying request to plugin");

    // Extract organization ID (from auth, subdomain, or query param)
    const organizationId = await extractorganizationId(req);

    if (!organizationId) {
      return res.status(401).json({
        error: "Organization ID required",
        message: "Could not determine organization from request",
      });
    }

    // Get or start worker for this org+plugin combination
    let worker;
    try {
      worker = await pluginManagerService.startPluginWorker(organizationId, pluginId);
      // Update activity timestamp so the instance cleanup job doesn't kill the worker
      pluginInstanceManagerService
        .updateActivityTimestamp(organizationId, pluginId)
        .catch(() => {});
    } catch (error) {
      logger.error({ err: error, organizationId, pluginId }, "Failed to start worker");
      return res.status(503).json({
        error: "Plugin unavailable",
        message: "Failed to start plugin worker",
      });
    }

    // Proxy request to worker
    const workerUrl = `http://localhost:${worker.port}${path}${req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : ""}`;

    logger.debug({ workerUrl }, "Forwarding request to worker");

    try {
      // Convert Express headers to fetch-compatible headers
      // Strip sensitive headers to prevent credential leakage to plugin workers
      const STRIPPED_HEADERS = new Set([
        "authorization",
        "cookie",
        "x-forwarded-for",
        "x-real-ip",
        "proxy-authorization",
        "content-length", // Removed: proxy re-encodes body as JSON, so original content-length is wrong
      ]);
      const headers: Record<string, string> = {};
      Object.entries(req.headers).forEach(([key, value]) => {
        if (STRIPPED_HEADERS.has(key.toLowerCase())) return;
        if (typeof value === "string") {
          headers[key] = value;
        } else if (Array.isArray(value)) {
          headers[key] = value[0]; // Take first value for array headers
        }
      });
      headers.host = `localhost:${worker.port}`; // Override host header

      // When forwarding, we JSON.stringify the body (Express already parsed it).
      // Set Content-Type to match and pass original request info for signature validation.
      if (req.method !== "GET" && req.method !== "HEAD") {
        const originalContentType = headers["content-type"];
        headers["content-type"] = "application/json";
        if (originalContentType) {
          headers["x-original-content-type"] = originalContentType;
        }
        // Pass the original URL so plugins can reconstruct it for webhook signature validation
        headers["x-original-url"] = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

        logger.debug(
          {
            protocol: req.protocol,
            forwardedProto: req.get("x-forwarded-proto"),
            host: req.get("host"),
            originalUrl: req.originalUrl,
            constructedUrl: headers["x-original-url"],
            originalContentType: originalContentType,
          },
          "Webhook proxy URL construction",
        );
      }

      const response = await fetch(workerUrl, {
        method: req.method,
        headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
      });

      // Copy status
      res.status(response.status);

      // Copy headers
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      // Stream body
      const data = await response.text();
      return res.send(data);
    } catch (error) {
      logger.error({ err: error }, "Error forwarding to worker");
      return res.status(502).json({
        error: "Bad gateway",
        message: "Failed to communicate with plugin worker",
      });
    }
  } catch (error) {
    logger.error({ err: error }, "Unexpected error in plugin proxy");
    return res.status(500).json({
      error: "Internal server error",
      message: "An unexpected error occurred",
    });
  }
});

/**
 * Extract organization ID from request
 * Tries multiple methods:
 * 1. Query parameter (for webhooks without auth) — validated against DB
 * 2. Subdomain (for custom domains)
 * 3. Auth token (for authenticated requests)
 */
async function extractorganizationId(req: Request): Promise<string | null> {
  // Method 1: From query parameter (for webhooks)
  // Validate UUID format and verify org exists to prevent IDOR
  if (req.query.organizationId && typeof req.query.organizationId === "string") {
    const orgId = req.query.organizationId;
    if (!isValidUuid(orgId)) {
      return null;
    }
    const org = await organizationRepository.findById(orgId);
    if (!org) {
      return null;
    }
    return orgId;
  }

  // Method 2: From x-organization-id header
  // This route has no auth middleware, so the header is user-controllable.
  // Apply the same UUID + DB existence validation as query params.
  const headerOrgId = req.headers["x-organization-id"];
  if (headerOrgId && typeof headerOrgId === "string") {
    if (!isValidUuid(headerOrgId)) {
      return null;
    }
    const org = await organizationRepository.findById(headerOrgId);
    if (!org) {
      return null;
    }
    return headerOrgId;
  }

  // TODO: Method 3 - From auth token (JWT) if needed for authenticated webhook endpoints

  return null;
}

export default router;
