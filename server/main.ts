import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import type { FileFilterCallback } from "multer";
import cors from "cors";
import helmet from "helmet";
import { httpCompression } from "@server/lib/http-compression";
import { webchatStatic } from "@server/lib/webchat-static";
import { createServer } from "http";
import { config, validateProductionConfig } from "@server/config/env";
import { createContext } from "@server/trpc/context";
import { AppDataSource, initializeDatabase } from "@server/database/data-source";
import { createLogger } from "@server/lib/logger";
import { initTelemetry, captureException, shutdownTelemetry } from "@server/lib/telemetry";
import { requestContext } from "@server/lib/request-context";
import { startMetricsServer } from "@server/lib/metrics-server";
import { isPublicUploadPath, setPublicUploadHeaders } from "@server/services/media-url.service";
import {
  bodyLimitForPath,
  DEFAULT_BODY_LIMIT,
  isPublicWidgetPath,
  UPLOAD_BODY_LIMIT,
} from "@server/lib/body-limits";
import { mayParseLargeBody } from "@server/lib/large-body-auth";
import { httpIpRateLimit, trpcRetryAfterMeta } from "@server/lib/http-rate-limit";
import "reflect-metadata";
import dotenv from "dotenv";
import { orgDashboardPath } from "@server/lib/dashboard-links";

dotenv.config({ quiet: true });

const logger = createLogger("server");
const trpcLogger = createLogger("trpc");

// Client-driven outcomes that say nothing about the health of the server.
// NOT_FOUND covers bots/scanners probing nonexistent procedure paths (e.g. "/v1/.env"),
// BAD_REQUEST covers input validation and precondition failures. PARSE_ERROR,
// UNSUPPORTED_MEDIA_TYPE and METHOD_NOT_SUPPORTED are malformed HTTP requests
// (bad JSON, a POST with no content-type, the wrong verb) that tRPC rejects
// before any procedure runs.
const EXPECTED_TRPC_ERROR_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "TOO_MANY_REQUESTS",
  "NOT_FOUND",
  "BAD_REQUEST",
  "PARSE_ERROR",
  "UNSUPPORTED_MEDIA_TYPE",
  "METHOD_NOT_SUPPORTED",
]);

const SHUTDOWN_TIMEOUT_MS = 30000;

async function startServer() {
  // Validate required environment variables in production
  for (const warning of validateProductionConfig()) {
    logger.warn(warning);
  }

  // Set server timezone to UTC for consistent timestamp handling
  process.env.TZ = "UTC";

  // No-op unless POSTHOG_KEY is set.
  initTelemetry();

  // Initialize database connection (required - will retry 3 times with 2s delay)
  await initializeDatabase();

  // Initialize Redis service
  const { redisService } = await import("@server/services/redis.service");
  try {
    await redisService.initialize();
  } catch (error) {
    logger.warn("Starting server without Redis connection");
  }

  // Initialize Channel Delivery service: consumes the durable delivery queue and
  // sends outbound bot/agent messages to external channels (WhatsApp, etc.)
  const { channelDeliveryService } = await import("@server/services/channel-delivery.service");
  try {
    await channelDeliveryService.initialize();
  } catch (error) {
    logger.warn("Starting server without channel delivery service");
  }

  // Initialize RabbitMQ service and declare orchestrator queues
  const { rabbitmqService } = await import("@server/services/rabbitmq.service");
  try {
    await rabbitmqService.initialize();
    const { orchestratorQueueService } =
      await import("@server/services/orchestrator-queue.service");
    await orchestratorQueueService.declareQueues();
  } catch (error) {
    logger.warn("Starting server without RabbitMQ connection");
  }

  // Initialize Job Queue service (depends on Redis)
  const { jobQueueService } = await import("@server/services/job-queue.service");
  try {
    await jobQueueService.initialize();
  } catch (error) {
    logger.warn("Starting server without Job Queue service");
  }

  // Initialize Scheduler service (depends on Database)
  const { schedulerService } = await import("@server/services/scheduler.service");
  const { registerAllScheduledJobs } = await import("@server/services/scheduled-jobs.registry");
  try {
    await schedulerService.initialize();
    registerAllScheduledJobs();
  } catch (error) {
    logger.warn({ err: error }, "Starting server without Scheduler service");
  }

  // Import services after database initialization to avoid circular dependency issues
  const { orchestratorWorker } = await import("@server/workers/orchestrator.worker");
  const { pluginManagerService } = await import("@server/services/plugin-manager.service");
  const { getPluginRunnerService } = await import("@server/services/plugin-runner.service");
  const { pluginInstanceManagerService } =
    await import("@server/services/plugin-instance-manager.service");
  const { pluginInstanceRepository: _pluginInstanceRepository } =
    await import("@server/repositories/plugin-instance.repository");
  const { pluginAssetService } = await import("@server/services/plugin-asset.service");
  const { websocketService } = await import("@server/services/websocket.service");

  const server = express();

  // Behind the reverse proxy, req.ip is the address the proxy saw (see
  // lib/client-ip.ts), not whatever X-Forwarded-For a client sent.
  server.set("trust proxy", config.server.trustProxy);

  server.use(requestContext);

  // Baseline security headers. The default CSP suits JSON and plain-text
  // responses (nothing loads, nothing may frame them); routes that serve HTML
  // or files set their own CSP (webchat challenge, media, plugin assets,
  // public uploads). Resources are loaded cross-origin by the dashboard and
  // the widget.
  server.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: "deny" },
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      strictTransportSecurity: config.domain.useSSL,
    }),
  );

  // Add permissive CORS middleware for public widget endpoints
  // This allows the widget to be embedded on any domain
  server.use((req, res, next) => {
    if (isPublicWidgetPath(req.path)) {
      return cors({
        origin: true, // Allow all origins
        credentials: false,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "x-organization-id"],
        exposedHeaders: ["Content-Range", "X-Total-Count"],
        maxAge: 86400,
        optionsSuccessStatus: 204,
      })(req, res, next);
    }
    next();
  });

  // Add CORS middleware with proper configuration for other endpoints
  server.use(
    cors({
      origin: config.cors.origin,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-organization-id"],
      exposedHeaders: ["Content-Range", "X-Total-Count"],
      maxAge: 86400,
      optionsSuccessStatus: 204,
    }),
  );

  // After CORS so a 429 still carries the CORS headers the browser needs to read it.
  server.use((req, res, next) => void httpIpRateLimit(req, res, next));

  server.use(httpCompression());

  // JSON/urlencoded parsing with a 1 MB default and larger limits only on the
  // routes that carry base64 files (lib/body-limits.ts).
  // The `verify` hook captures the raw request bytes on `req.rawBody` so that
  // downstream consumers (e.g. the plugin proxy → channel plugins) can verify
  // HMAC signatures that are computed over the exact bytes the client sent.
  const captureRawBody = (req: express.Request, _res: express.Response, buf: Buffer): void => {
    if (buf && buf.length > 0) {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    }
  };
  const bodyParsers = new Map<string, express.RequestHandler[]>();
  server.use((req, res, next) => {
    void (async () => {
      let limit = bodyLimitForPath(req.path);
      if (limit === UPLOAD_BODY_LIMIT && !(await mayParseLargeBody(req))) {
        limit = DEFAULT_BODY_LIMIT;
      }
      let parsers = bodyParsers.get(limit);
      if (!parsers) {
        // File uploads are never signature-checked, so no second copy of them.
        const verify = limit === UPLOAD_BODY_LIMIT ? undefined : captureRawBody;
        parsers = [
          express.json({ limit, verify }),
          express.urlencoded({ extended: true, limit, verify }),
        ];
        bodyParsers.set(limit, parsers);
      }
      const [json, urlencoded] = parsers;
      json(req, res, (err?: unknown) => (err ? next(err) : urlencoded(req, res, next)));
    })().catch(next);
  });

  server.get("/", (req, res) => {
    res.send("Welcome to Hay.chat");
  });

  // Liveness: the process is up and serving HTTP. Registered at both `/health`
  // (internal — used by deploy.sh) and `/v1/health` (externally reachable via
  // the reverse proxy's `/v1` route; `/health` is not proxied). Reveals no internals.
  const healthHandler = (_req: express.Request, res: express.Response): void => {
    res.json({ status: "ok" });
  };
  server.get("/health", healthHandler);
  server.get("/v1/health", healthHandler);

  // Readiness (internal, not proxied): 503 while a dependency is down so a
  // load balancer or deploy script stops routing traffic to this instance.
  server.get("/ready", async (_req, res) => {
    const database = await AppDataSource.query("SELECT 1")
      .then(() => true)
      .catch(() => false);
    const checks = {
      database,
      redis: redisService.isConnected(),
      rabbitmq: rabbitmqService.isConnected(),
    };
    const ready = Object.values(checks).every(Boolean);
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable", checks });
  });

  // Serve uploaded files from local storage
  const uploadDir = require("path").resolve(config.storage.local.uploadDir);
  if (!require("fs").existsSync(uploadDir)) {
    require("fs").mkdirSync(uploadDir, { recursive: true });
  }
  // Only public folders (logos, avatars, document images); private files go through /v1/media.
  server.use(
    "/uploads",
    (req, res, next) => (isPublicUploadPath(req.path) ? next() : res.status(404).end()),
    express.static(uploadDir, {
      maxAge: "7d",
      etag: true,
      lastModified: true,
      setHeaders: setPublicUploadHeaders,
    }),
  );

  // Serve webchat widget files
  // Navigate up from current directory until we find the project root (where webchat exists)
  const path = require("path");
  const fs = require("fs");
  let projectRoot = __dirname;
  while (!fs.existsSync(path.join(projectRoot, "webchat", "dist")) && projectRoot !== "/") {
    projectRoot = path.resolve(projectRoot, "..");
  }
  const webchatDir = path.join(projectRoot, "webchat", "dist");
  logger.debug({ webchatDir }, "Serving webchat files");
  // The widget CSS is inlined into widget.js at build time, but embed snippets in the
  // wild still <link> to widget.css. Serve an empty stylesheet so those requests don't
  // fall through to the tRPC router as NOT_FOUND errors.
  server.get("/v1/webchat/widget.css", (_req, res) => {
    res
      .set({
        "Content-Type": "text/css",
        "Cache-Control": "public, max-age=604800",
        "Access-Control-Allow-Origin": "*",
      })
      .send("/* Widget styles are bundled into widget.js */\n");
  });
  // Hay.chat-hosted challenge frame for webchat bot checks (D9-8). Mounted before
  // the static files so it is never shadowed by a file of the same name.
  const { webchatChallengeHandler } = await import("@server/routes/webchat-challenge");
  // Framed by customer sites: its CSP frame-ancestors decides who may embed it.
  server.get("/v1/webchat/challenge", (req, res) => {
    res.removeHeader("X-Frame-Options");
    void webchatChallengeHandler(req, res);
  });
  // widget.js (the loader) gets a short cache; the hashed chunks under assets/
  // are immutable. See lib/webchat-static.ts.
  server.use("/v1/webchat", webchatStatic(webchatDir));

  // Plugin routes — plugin IDs are plain strings without slashes (e.g., hay-channel-instagram-meta).

  // Plugin thumbnail route - serves the plugin's thumbnail (svg > png > jpg)
  server.get(/^\/plugins\/thumbnails\/([^/]+)$/, (req, res) => {
    req.params = { pluginName: req.params[0] };
    pluginAssetService.serveThumbnail(req, res).catch((error) => {
      logger.error({ err: error }, "Thumbnail serving error");
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin public directory route - serve any file from plugin's public folder
  server.get(/^\/plugins\/public\/([^/]+)\/(.*)$/, (req, res) => {
    req.params = { pluginName: req.params[0], filePath: req.params[1] };
    pluginAssetService.servePublicFile(req, res).catch((error) => {
      logger.error({ err: error }, "Public file serving error");
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin UI assets route - serve dist/ files (ui.js, etc.). The dashboard
  // loads these with <script>/<link> tags, which carry no auth header, so each
  // URL is signed for one organization by `plugins.getUiAssetUrls`.
  server.get(/^\/plugins\/ui\/([^/]+)\/(.+)$/, async (req, res) => {
    req.params = { pluginName: req.params[0], assetPath: req.params[1] };

    try {
      await pluginAssetService.serveUIAsset(req, res);
    } catch (error) {
      logger.error({ err: error }, "UI asset serving error");
      res.status(500).json({ error: "Failed to load UI asset" });
    }
  });

  // Plugin worker proxy route - proxy requests to plugin workers
  // This is for the new TypeScript-based plugin system with process isolation
  const pluginProxyRouter = require("@server/routes/v1/plugins/proxy").default;
  server.use("/v1/plugins", pluginProxyRouter);

  // OAuth callback route - handle OAuth redirects from providers
  server.get("/oauth/callback", async (req, res) => {
    logger.debug("OAuth callback endpoint hit");

    const { oauthService } = await import("@server/services/oauth.service");
    const { getDashboardUrl } = await import("@server/config/env");

    // HTML-encode a string to prevent XSS in rendered HTML
    const escapeHtml = (str: string) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const { code, state, error } = req.query;

    if (!code && !error) {
      return res.status(400).send(`
        <html>
          <head><title>OAuth Error</title></head>
          <body>
            <h1>OAuth Error</h1>
            <p>Missing authorization code or error parameter.</p>
            <a href="${getDashboardUrl()}">Return to Dashboard</a>
          </body>
        </html>
      `);
    }

    try {
      const result = await oauthService.handleCallback(
        code as string,
        state as string,
        error as string | undefined,
      );

      if (result.success) {
        // Back to the external page that started the connect (origin was
        // allowlisted at initiate time), else the dashboard plugin settings page.
        const dashboardUrl = getDashboardUrl();
        const encodedPluginId = encodeURIComponent(result.pluginId!);
        const pluginPath = `/integrations/plugins/${encodedPluginId}?oauth=success`;
        let redirectUrl = `${dashboardUrl}${result.organizationId ? orgDashboardPath(result.organizationId, pluginPath) : pluginPath}`;
        if (result.returnTo) {
          // Tell the external page the outcome so it can confirm it to the user.
          const back = new URL(result.returnTo);
          back.searchParams.set("hay_connect", "success");
          redirectUrl = back.toString();
        }
        logger.info({ pluginId: result.pluginId }, "OAuth callback successful");
        return res.redirect(redirectUrl);
      } else {
        logger.warn({ error: result.error }, "OAuth callback failed");
        if (result.returnTo) {
          const back = new URL(result.returnTo);
          back.searchParams.set("hay_connect", "error");
          back.searchParams.set("hay_connect_error", (result.error || "unknown").slice(0, 200));
          return res.redirect(back.toString());
        }
        // Show error page
        return res.status(400).send(`
          <html>
            <head><title>OAuth Error</title></head>
            <body>
              <h1>OAuth Authorization Failed</h1>
              <p>${escapeHtml(result.error || "Unknown error occurred")}</p>
              <a href="${getDashboardUrl()}">Return to Dashboard</a>
            </body>
          </html>
        `);
      }
    } catch (error) {
      logger.error({ err: error }, "OAuth callback exception");
      return res.status(500).send(`
        <html>
          <head><title>OAuth Error</title></head>
          <body>
            <h1>Internal Server Error</h1>
            <p>An error occurred while processing the OAuth callback.</p>
            <a href="${getDashboardUrl()}">Return to Dashboard</a>
          </body>
        </html>
      `);
    }
  });

  // GitHub App installation callback
  // GitHub redirects here after app installation with installation_id and setup_action.
  // The state parameter may or may not be present depending on how the user reached the install page.
  // We redirect to the dashboard which will complete the connection via tRPC (authenticated).
  server.get("/github/callback", async (req, res) => {
    const { getDashboardUrl: getDashUrl } = await import("@server/config/env");
    const { installation_id, setup_action } = req.query;

    if (!installation_id) {
      return res.status(400).send(`
        <html>
          <head><title>GitHub Error</title></head>
          <body>
            <h1>GitHub App Installation Error</h1>
            <p>Missing installation_id parameter.</p>
            <a href="${getDashUrl()}">Return to Dashboard</a>
          </body>
        </html>
      `);
    }

    // Redirect to dashboard with the installation_id — the frontend will call
    // the authenticated tRPC endpoint to complete the connection.
    const dashboardUrl = getDashUrl();
    const params = new URLSearchParams({
      installation_id: installation_id as string,
      setup_action: (setup_action as string) || "install",
    });
    return res.redirect(`${dashboardUrl}/settings/git-connections?${params.toString()}`);
  });

  // Resend email events (bounces, complaints, deliveries) — D13-10
  const emailEventsRouter = await import("@server/routes/email-events");
  server.use(emailEventsRouter.default);

  // Well-known endpoints for OAuth Client Metadata Document (CIMD)
  const wellKnownRouter = await import("@server/routes/well-known");
  server.use(wellKnownRouter.default);

  // Initialize plugin system BEFORE creating the router
  try {
    await pluginManagerService.initialize();
    logger.info("Plugin manager initialized");

    // Register plugin-declared cron jobs for enabled orgs (depends on plugin
    // metadata populated by the manager above).
    const { pluginCronService } = await import("@server/services/plugin-cron.service");
    await pluginCronService.initialize();
  } catch (error) {
    logger.error({ err: error }, "Failed to initialize plugin system");
  }

  // Plugin upload endpoints
  const multer = await import("multer");
  const { withAdminAuth, withMfaStepUp } = await import("@server/middleware/auth");
  const { pluginUploadService, requireCustomPluginsAllowed, handlePluginUploadError } =
    await import("@server/services/plugin-upload.service");

  // Multer configuration for plugin uploads
  const pluginUpload = multer.default({
    storage: multer.default.memoryStorage(),
    limits: {
      fileSize: config.plugins.maxUploadSizeMB * 1024 * 1024,
      files: 1,
    },
    fileFilter: (_req: express.Request, file: Express.Multer.File, cb: FileFilterCallback) => {
      if (file.mimetype === "application/zip" || file.mimetype === "application/x-zip-compressed") {
        cb(null, true);
      } else {
        cb(new Error("Only ZIP files are allowed"));
      }
    },
  });

  // Plugin upload routes
  server.post(
    "/v1/plugins/upload",
    withAdminAuth,
    withMfaStepUp,
    requireCustomPluginsAllowed,
    pluginUpload.single("plugin"),
    async (req: express.Request, res: express.Response) => {
      await pluginUploadService.handleUpload(req, res);
    },
    handlePluginUploadError,
  );

  server.put(
    "/v1/plugins/:pluginId",
    withAdminAuth,
    withMfaStepUp,
    requireCustomPluginsAllowed,
    pluginUpload.single("plugin"),
    async (req: express.Request, res: express.Response) => {
      await pluginUploadService.handleUpdate(req, res);
    },
    handlePluginUploadError,
  );

  server.delete("/v1/plugins/:pluginId", withAdminAuth, async (req, res) => {
    await pluginUploadService.handleDelete(req, res);
  });

  // Plugin API routes - secure HTTP endpoints for plugins to call back to the server
  const pluginAPIRouter = await import("@server/routes/v1/plugin-api/index");
  server.use("/v1/plugin-api", pluginAPIRouter.default);

  // Private uploads (conversation media): staff session or signed URL
  const mediaRouter = await import("@server/routes/v1/media/index");
  server.use("/v1/media", mediaRouter.default);

  const { noStoreOnAuthRoutes } = await import("@server/lib/auth/session-cookie");
  const { v1Router } = await import("@server/routes/v1");
  server.use("/v1", noStoreOnAuthRoutes);
  server.use(
    "/v1",
    createExpressMiddleware({
      router: v1Router,
      createContext,
      responseMeta: trpcRetryAfterMeta,
      // Without this, every failed procedure (validation, auth, unhandled throw) is
      // returned to the client and never written to the logs, leaving production
      // incidents undiagnosable. Input is omitted -- it can carry customer data.
      onError({ error, path, type, ctx }) {
        trpcLogger.error(
          { err: error, cause: error.cause, path, type, code: error.code },
          "tRPC procedure failed",
        );

        // Expected outcomes rather than defects -- expired tokens, permission
        // checks and rate limits are high-volume and would drown real errors.
        if (EXPECTED_TRPC_ERROR_CODES.has(error.code)) {
          return;
        }

        captureException(error.cause ?? error, {
          userId: ctx?.user?.id,
          organizationId: ctx?.organizationId,
          // No `input` -- it can carry customer data.
          properties: { trpc_path: path, trpc_type: type, trpc_code: error.code },
        });
      },
    }),
  );

  // Create HTTP server
  const httpServer = createServer(server);

  // WebSocket server shares the HTTP server
  await websocketService.initialize(httpServer);

  interface ServerError extends Error {
    code?: string;
  }

  httpServer.on("error", (error: ServerError) => {
    if (error.code === "EADDRINUSE") {
      logger.error({ port: config.server.port }, "Port is already in use");
      process.exit(1);
    }
    logger.error({ err: error }, "Server error");
    process.exit(1);
  });

  const { registerRuntimeMetrics } = await import("@server/services/runtime-metrics");
  registerRuntimeMetrics();
  const metricsServer = startMetricsServer();

  httpServer.listen(config.server.port, async () => {
    logger.info({ port: config.server.port }, "Server is running");

    const { setUsageSink } = await import("@server/services/llm/usage-sink");
    const { recordOrgUsage } = await import("@server/services/llm/org-usage-budget");
    setUsageSink(recordOrgUsage);

    // Start the orchestrator worker (subscribes to RabbitMQ queue)
    await orchestratorWorker.start();
    logger.info("Orchestrator worker started");

    // Initialize plugin pages management (plugin system already initialized)
    try {
      // Initialize plugin pages management
      const { pluginPagesService } = await import("./services/plugin-pages.service");
      await pluginPagesService.initialize();
      logger.info("Plugin pages synced with dashboard");

      // Start plugin instance lifecycle management
      pluginInstanceManagerService.startCleanup();
      logger.info("Plugin instance lifecycle manager started");

      // Note: Plugins will now be started on-demand when needed
      // This improves scalability and resource usage
      logger.info("Plugin system ready (on-demand instance startup enabled)");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize plugin system");
    }
  });

  // Graceful shutdown: stop taking requests and background work, let in-flight
  // work finish, then close connections. A hard timeout guarantees exit.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down gracefully");

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Graceful shutdown timed out, exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    const step = async (name: string, fn: () => unknown): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        logger.error({ err: error, step: name }, "Shutdown step failed");
      }
    };

    metricsServer?.close();
    const httpClosed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await step("orchestrator", () => orchestratorWorker.stop());
    await step("plugin-cleanup", () => pluginInstanceManagerService.stopCleanup());
    await step("websocket", () => websocketService.shutdown());
    await step("background-work", () =>
      Promise.all([
        jobQueueService.shutdown(15000),
        schedulerService.shutdown({ gracefulTimeout: 15000 }),
        channelDeliveryService.stop(15000),
      ]),
    );
    await step("http", () => {
      httpServer.closeIdleConnections();
      return httpClosed;
    });
    await step("rabbitmq", () => rabbitmqService.shutdown());
    await step("plugin-workers", () => getPluginRunnerService().stopAllWorkers());
    await step("redis", () => redisService.shutdown());
    await step("database", () =>
      AppDataSource.isInitialized ? AppDataSource.destroy() : undefined,
    );
    await step("telemetry", () => shutdownTelemetry());
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Start the server
startServer().catch((error) => {
  logger.error({ err: error }, "Failed to start server");
  process.exit(1);
});
