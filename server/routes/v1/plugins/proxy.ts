import { Router, type Request, type Response } from "express";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { organizationRepository } from "@server/repositories/organization.repository";

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

    console.log(`[PluginProxy] ${req.method} ${req.path} -> /${pluginId}${path}`);

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
      console.error(
        `[PluginProxy] Failed to start worker for ${organizationId}:${pluginId}:`,
        error,
      );
      return res.status(503).json({
        error: "Plugin unavailable",
        message: error instanceof Error ? error.message : "Failed to start plugin worker",
      });
    }

    // Proxy request to worker
    const workerUrl = `http://localhost:${worker.port}${path}${req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : ""}`;

    console.log(`[PluginProxy] Forwarding to ${workerUrl}`);

    try {
      // Convert Express headers to fetch-compatible headers
      const headers: Record<string, string> = {};
      Object.entries(req.headers).forEach(([key, value]) => {
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
      console.error(`[PluginProxy] Error forwarding to worker:`, error);
      return res.status(502).json({
        error: "Bad gateway",
        message: "Failed to communicate with plugin worker",
      });
    }
  } catch (error) {
    console.error("[PluginProxy] Unexpected error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * Extract organization ID from request
 * Tries multiple methods:
 * 1. Query parameter (for webhooks without auth)
 * 2. Subdomain (for custom domains)
 * 3. Auth token (for authenticated requests)
 */
async function extractorganizationId(req: Request): Promise<string | null> {
  // Method 1: From query parameter (for webhooks)
  if (req.query.organizationId && typeof req.query.organizationId === "string") {
    return req.query.organizationId;
  }

  // Method 2: From subdomain
  // TODO: Implement subdomain lookup once OrganizationRepository has findBySubdomain method
  // const hostname = req.hostname || req.get("host") || "";
  // const subdomain = hostname.split(".")[0];
  // if (subdomain && subdomain !== "app" && subdomain !== "localhost" && subdomain !== "api") {
  //   try {
  //     const org = await organizationRepository.findBySubdomain(subdomain);
  //     if (org) {
  //       return org.id;
  //     }
  //   } catch (error) {
  //     console.warn(`[PluginProxy] Failed to lookup org by subdomain ${subdomain}:`, error);
  //   }
  // }

  // Method 3: From auth token (if authenticated request)
  // This would be extracted from JWT in the Authorization header
  // TODO: Implement if needed for authenticated webhook endpoints

  return null;
}

export default router;
