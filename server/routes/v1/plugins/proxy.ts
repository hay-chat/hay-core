import { Router, type Request, type Response } from "express";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { organizationRepository } from "@server/repositories/organization.repository";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("plugin-proxy");

const router = Router();

/**
 * Proxy all requests to plugin workers
 * URL pattern: /v1/plugins/:pluginId/*
 *
 * This route forwards external requests (webhooks, callbacks) to the appropriate
 * plugin worker process. The worker is automatically started if not running.
 */
router.all("/:pluginId/*path", async (req: Request, res: Response) => {
  try {
    const { pluginId } = req.params;
    const path = (req.params as any).path ? `/${(req.params as any).path}` : "";

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
    // Basic UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orgId)) {
      return null;
    }
    // Verify org exists to prevent access to arbitrary org IDs
    const org = await organizationRepository.findById(orgId);
    if (!org) {
      return null;
    }
    return orgId;
  }

  // Method 2: From x-organization-id header (set by authenticated middleware)
  const headerOrgId = req.headers["x-organization-id"];
  if (headerOrgId && typeof headerOrgId === "string") {
    return headerOrgId;
  }

  // TODO: Method 3 - From auth token (JWT) if needed for authenticated webhook endpoints

  return null;
}

export default router;
