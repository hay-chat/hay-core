import { Router, type Request, type Response } from "express";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginInstanceManagerService } from "@server/services/plugin-instance-manager.service";
import { webhookRouterService } from "@server/services/webhook-router.service";
import { organizationRepository } from "@server/repositories/organization.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { getPluginRunnerService } from "@server/services/plugin-runner.service";
import { WORKER_HOST, workerFetch } from "@server/lib/worker-client";
import type { RouteDescriptor } from "@server/types/plugin-sdk.types";
import { isValidUuid } from "@server/lib/validation/uuid";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("plugin-proxy");

const router = Router();

/**
 * Proxy all requests to plugin workers
 * URL pattern: /v1/plugins/:pluginId/*
 *
 * Plugin IDs are plain strings without slashes (e.g., hay-channel-instagram-meta).
 * Match groups: [1] = pluginId, [2] = remaining path
 */
router.all(/^\/([^/]+)\/(.*)?$/, async (req: Request, res: Response): Promise<void> => {
  try {
    const pluginId = req.params[0];
    const path = req.params[1] ? `/${req.params[1]}` : "";

    logger.debug({ method: req.method, path: req.path, pluginId }, "Proxying request to plugin");

    // Worker control endpoints and channel delivery routes are called by core
    // over localhost only. Exposing them here would let anyone who knows an org
    // id run MCP tools, send channel messages or swap the worker's credentials.
    if (isWorkerInternalPath(path)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Generic shared-webhook fan-out: when a plugin DECLARES a webhook routing
    // strategy (in its metadata) and the request carries no org id, core resolves
    // the org(s) from the payload and fans the single shared webhook URL out to
    // the right per-org workers. Core stays plugin-agnostic — it only executes
    // the declared strategy as data. Anything else falls through to the existing
    // per-org proxy behavior unchanged.
    if (path === "/webhook" && !hasOrgIdentifier(req)) {
      const routing = await webhookRouterService.getRoutingDescriptor(pluginId);
      if (routing) {
        await webhookRouterService.handle(req, res, pluginId, routing);
        return;
      }
    }

    // Provider deauthorize / data-deletion callbacks for the same shared app,
    // served by core when the plugin declares `webhookRouting.deauthorization`.
    if ((path === "/deauthorize" || path === "/data-deletion") && !hasOrgIdentifier(req)) {
      const deauthorization = (await webhookRouterService.getRoutingDescriptor(pluginId))
        ?.deauthorization;
      if (deauthorization) {
        if (path === "/data-deletion" && req.method === "GET") {
          webhookRouterService.handleDataDeletionStatus(req, res);
          return;
        }
        await webhookRouterService.handleDeauthorization(
          req,
          res,
          pluginId,
          deauthorization,
          path === "/deauthorize" ? "deauthorize" : "data-deletion",
        );
        return;
      }
    }

    // Extract organization ID (from auth, subdomain, or query param)
    const organizationId = await extractorganizationId(req);

    if (!organizationId) {
      res.status(401).json({
        error: "Organization ID required",
        message: "Could not determine organization from request",
      });
      return;
    }

    // Only orgs that enabled this plugin can reach its worker.
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    if (!instance?.enabled) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Only routes the plugin declared with register.route() are reachable. When
    // metadata is cached, check before waking a worker; otherwise after start.
    const cachedRoutes = pluginManagerService.getPlugin(pluginId)?.metadata?.routes;
    if (cachedRoutes && !isDeclaredRoute(cachedRoutes, req.method, path)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (!getPluginRunnerService().isRunning(organizationId, pluginId)) {
      if (!takeColdStartSlot(pluginId)) {
        res.setHeader("Retry-After", String(Math.ceil(COLD_START_WINDOW_MS / 1000)));
        res.status(429).json({ error: "Too many requests" });
        return;
      }
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
      res.status(503).json({
        error: "Plugin unavailable",
        message: "Failed to start plugin worker",
      });
      return;
    }

    const declaredRoutes = pluginManagerService.getPlugin(pluginId)?.metadata?.routes ?? [];
    if (!isDeclaredRoute(declaredRoutes, req.method, path)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Proxy request to worker
    const workerPath = `${path}${req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : ""}`;

    logger.debug({ port: worker.port, path }, "Forwarding request to worker");

    try {
      const { headers, body } = buildWorkerForward(req, worker.port);

      const response = await workerFetch(worker.port, workerPath, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(WORKER_FORWARD_TIMEOUT_MS),
      });

      // Copy status
      res.status(response.status);

      // Copy headers
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      // Stream body
      const data = await response.text();
      res.send(data);
    } catch (error) {
      logger.error({ err: error }, "Error forwarding to worker");
      res.status(502).json({
        error: "Bad gateway",
        message: "Failed to communicate with plugin worker",
      });
    }
  } catch (error) {
    logger.error({ err: error }, "Unexpected error in plugin proxy");
    res.status(500).json({
      error: "Internal server error",
      message: "An unexpected error occurred",
    });
  }
});

/**
 * Whether `method path` matches a route the plugin declared with
 * register.route(). Matches the way the worker's Express router resolves
 * paths: case-insensitive, `:param` segments, optional trailing slash, and
 * HEAD served by GET routes.
 */
export function isDeclaredRoute(
  routes: Pick<RouteDescriptor, "method" | "path">[],
  method: string,
  path: string,
): boolean {
  const requestMethod = method.toUpperCase();
  const requestSegments = pathSegments(path);
  if (requestSegments === null) return false;
  return routes.some((route) => {
    const routeMethod = String(route.method).toUpperCase();
    if (routeMethod !== requestMethod && !(requestMethod === "HEAD" && routeMethod === "GET")) {
      return false;
    }
    const routeSegments = pathSegments(route.path);
    if (routeSegments === null || routeSegments.length !== requestSegments.length) return false;
    return routeSegments.every(
      (segment, i) =>
        (segment.startsWith(":") && requestSegments[i].length > 0) ||
        segment.toLowerCase() === requestSegments[i].toLowerCase(),
    );
  });
}

/** Path segments without the leading/trailing slash; null for empty segments. */
function pathSegments(path: string): string[] | null {
  const trimmed = path.replace(/^\//, "").replace(/\/$/, "");
  if (trimmed === "") return [];
  const segments = trimmed.split("/");
  return segments.some((segment) => segment === "") ? null : segments;
}

// Upper bound for a plugin route to answer a forwarded request.
const WORKER_FORWARD_TIMEOUT_MS = 30_000;

// Cold starts (waking a worker that isn't running) per plugin, per window. The
// proxy is unauthenticated, so this bounds how fast it can spin up workers.
const COLD_START_WINDOW_MS = 60_000;
const MAX_COLD_STARTS_PER_WINDOW = 30;
const coldStarts = new Map<string, { windowStart: number; count: number }>();

/** Whether the proxy may cold-start another worker for `pluginId` right now. */
export function takeColdStartSlot(pluginId: string, now = Date.now()): boolean {
  const entry = coldStarts.get(pluginId);
  if (!entry || now - entry.windowStart >= COLD_START_WINDOW_MS) {
    coldStarts.set(pluginId, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= MAX_COLD_STARTS_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

/**
 * First path segments only core may call on a worker (over loopback): the SDK
 * runner's control endpoints, the channel `/deliver` + `/escalate` + `/templates` contract,
 * the `/disputes/*` evidence push (D2-7), the `/tickets/*` hand-off tickets, and
 * `/ui/*` (settings UI routes, reachable only via the authenticated, org-scoped
 * `plugins.callUiRoute`), and the `/setup/*` + `/webchat/*` runner endpoints.
 * Checked in addition to the declared-route allow-list, because plugins
 * declare some of these core-only routes with register.route() too.
 */
const WORKER_INTERNAL_SEGMENTS = new Set([
  "health",
  "metadata",
  "validate-auth",
  "on-connected",
  "config-update",
  "disable",
  "cron",
  "mcp",
  "deliver",
  "escalate",
  "templates",
  "disputes",
  "tickets",
  "ui",
  "setup",
  "webchat",
]);

/**
 * Whether a proxied path targets a worker-internal endpoint. Matches the way
 * the worker's Express router resolves paths: case-insensitive, ignoring empty
 * segments and a trailing slash.
 */
export function isWorkerInternalPath(path: string): boolean {
  const firstSegment = path.split("/").find((segment) => segment.length > 0);
  return firstSegment !== undefined && WORKER_INTERNAL_SEGMENTS.has(firstSegment.toLowerCase());
}

// Stripped to prevent credential leakage to plugin workers. content-length is
// recomputed by fetch for the forwarded body. x-hay-webhook-verified is set only
// by the webhook router after it checks the provider signature; a caller must
// never be able to supply it.
const STRIPPED_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-forwarded-for",
  "x-real-ip",
  "proxy-authorization",
  "content-length",
  "x-hay-webhook-verified",
  "x-hay-worker-secret",
]);

/**
 * Build the headers and body to forward to a worker.
 *
 * The original raw bytes (captured by the body-parser `verify` hook in main.ts
 * as `req.rawBody`) are forwarded as the request body under the original
 * content type, so the worker can parse them normally and plugins can verify
 * HMAC signatures over exactly what the provider signed. Only when no raw body
 * was captured do we fall back to re-encoding the parsed body as JSON.
 * `x-original-url` carries the external-facing URL for signature schemes that
 * include it.
 */
export function buildWorkerForward(
  req: Request,
  workerPort: number,
): { headers: Record<string, string>; body: string | undefined } {
  const headers: Record<string, string> = {};
  Object.entries(req.headers).forEach(([key, value]) => {
    if (STRIPPED_HEADERS.has(key.toLowerCase())) return;
    if (typeof value === "string") {
      headers[key] = value;
    } else if (Array.isArray(value)) {
      headers[key] = value[0];
    }
  });
  headers.host = `${WORKER_HOST}:${workerPort}`;

  if (req.method === "GET" || req.method === "HEAD") {
    return { headers, body: undefined };
  }

  // Behind a reverse proxy req.protocol is the internal hop; the external
  // protocol is in X-Forwarded-Proto.
  const externalProto = req.get("x-forwarded-proto") || req.protocol;
  headers["x-original-url"] = `${externalProto}://${req.get("host")}${req.originalUrl}`;

  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  if (typeof rawBody === "string" && rawBody.length > 0) {
    return { headers, body: rawBody };
  }

  headers["content-type"] = "application/json";
  return { headers, body: JSON.stringify(req.body ?? {}) };
}

/**
 * Whether the request supplies an org identifier (query param or header).
 * A shared webhook (no org in the URL) supplies neither — that's the signal to
 * route it through the generic webhook router instead of org extraction.
 */
function hasOrgIdentifier(req: Request): boolean {
  if (typeof req.query.organizationId === "string" && req.query.organizationId.length > 0) {
    return true;
  }
  const headerOrgId = req.headers["x-organization-id"];
  return typeof headerOrgId === "string" && headerOrgId.length > 0;
}

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
