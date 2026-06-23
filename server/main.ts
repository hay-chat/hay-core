import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import type { FileFilterCallback } from "multer";
import cors from "cors";
import { createServer } from "http";
import { config, validateProductionConfig } from "@server/config/env";
import { createContext } from "@server/trpc/context";
import { initializeDatabase } from "@server/database/data-source";
import { createLogger } from "@server/lib/logger";
import "reflect-metadata";
import "dotenv/config";

const logger = createLogger("server");

async function startServer() {
  // Validate required environment variables in production
  validateProductionConfig();

  // Set server timezone to UTC for consistent timestamp handling
  process.env.TZ = "UTC";

  // Initialize database connection (required - will retry 3 times with 2s delay)
  await initializeDatabase();

  // Initialize Redis service
  const { redisService } = await import("@server/services/redis.service");
  try {
    await redisService.initialize();
  } catch (error) {
    logger.warn("Starting server without Redis connection");
  }

  // Initialize Channel Delivery service (depends on Redis)
  // Listens for outbound bot/agent messages and delivers them to external channels (WhatsApp, etc.)
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
    // eslint-disable-next-line no-console
    console.warn("⚠️  Starting server without RabbitMQ connection");
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
  const { pluginRouteService } = await import("@server/services/plugin-route.service");
  const { websocketService } = await import("@server/services/websocket.service");

  const server = express();

  // Add permissive CORS middleware for public widget endpoints
  // This allows the widget to be embedded on any domain
  server.use((req, res, next) => {
    if (
      req.path.startsWith("/v1/publicConversations") ||
      req.path.startsWith("/v1/webchat.getPublicConfig")
    ) {
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

  // Add JSON parsing middleware with increased size limit for document uploads.
  // The `verify` hook captures the raw request bytes on `req.rawBody` so that
  // downstream consumers (e.g. the plugin proxy → channel plugins) can verify
  // HMAC signatures that are computed over the exact bytes the client sent.
  const captureRawBody = (req: express.Request, _res: express.Response, buf: Buffer): void => {
    if (buf && buf.length > 0) {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    }
  };
  server.use(express.json({ limit: "50mb", verify: captureRawBody }));
  server.use(express.urlencoded({ extended: true, limit: "50mb", verify: captureRawBody }));

  server.get("/", (req, res) => {
    res.send("Welcome to Hay");
  });

  // Health check endpoint.
  // Registered at both `/health` (internal — used by deploy.sh) and `/v1/health`
  // (externally reachable via the nginx `/v1` proxy; `/health` is not proxied).
  const healthHandler = (_req: express.Request, res: express.Response): void => {
    res.json({
      status: "ok",
      redis: redisService.isConnected(),
      rabbitmq: rabbitmqService.isConnected(),
    });
  };
  server.get("/health", healthHandler);
  server.get("/v1/health", healthHandler);

  // Serve uploaded files from local storage
  const uploadDir = require("path").resolve(config.storage.local.uploadDir);
  if (!require("fs").existsSync(uploadDir)) {
    require("fs").mkdirSync(uploadDir, { recursive: true });
  }
  server.use(
    "/uploads",
    express.static(uploadDir, {
      maxAge: "7d",
      etag: true,
      lastModified: true,
      setHeaders: (res, _filePath) => {
        // Security headers
        res.setHeader("X-Content-Type-Options", "nosniff");
      },
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
  server.use(
    "/v1/webchat",
    express.static(webchatDir, {
      maxAge: "7d",
      etag: true,
      lastModified: true,
      setHeaders: (res) => {
        // Security headers
        res.setHeader("X-Content-Type-Options", "nosniff");
        // Allow CORS for widget files so they can be loaded from any domain
        res.setHeader("Access-Control-Allow-Origin", "*");
      },
    }),
  );

  // Plugin routes — plugin IDs are plain strings without slashes (e.g., hay-channel-whatsapp-twilio).

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

  // Plugin UI assets route - serve dist/ files (ui.js, etc.)
  server.get(/^\/plugins\/ui\/([^/]+)\/(.+)$/, async (req, res) => {
    req.params = { pluginName: req.params[0], assetPath: req.params[1] };

    try {
      await pluginAssetService.serveUIAsset(req, res);
    } catch (error) {
      logger.error({ err: error }, "UI asset serving error");
      res.status(500).json({ error: "Failed to load UI asset" });
    }
  });

  // Plugin webhook routes - handle incoming webhooks from external services
  server.all(/^\/plugins\/webhooks\/([^/]+)\/(.*)$/, (req, res) => {
    req.params = { pluginName: req.params[0], webhookPath: req.params[1] };
    pluginRouteService.handleWebhook(req, res).catch((error) => {
      logger.error({ err: error }, "Webhook handling error");
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin webhook verification route - handle webhook verification challenges
  server.get(/^\/plugins\/webhooks\/([^/]+)$/, (req, res) => {
    req.params = { pluginName: req.params[0] };
    pluginRouteService.handleWebhookVerification(req, res).catch((error) => {
      logger.error({ err: error }, "Webhook verification error");
      res.status(500).json({ error: "Internal server error" });
    });
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
        // Redirect to dashboard plugin settings page with success message
        const dashboardUrl = getDashboardUrl();
        const encodedPluginId = encodeURIComponent(result.pluginId!);
        const redirectUrl = `${dashboardUrl}/integrations/plugins/${encodedPluginId}?oauth=success`;
        logger.info({ pluginId: result.pluginId }, "OAuth callback successful");
        return res.redirect(redirectUrl);
      } else {
        logger.warn({ error: result.error }, "OAuth callback failed");
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
  const { withAdminAuth } = await import("@server/middleware/auth");
  const { pluginUploadService } = await import("@server/services/plugin-upload.service");

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
    pluginUpload.single("plugin"),
    async (req, res) => {
      await pluginUploadService.handleUpload(req, res);
    },
  );

  server.put(
    "/v1/plugins/:pluginId",
    withAdminAuth,
    pluginUpload.single("plugin"),
    async (req, res) => {
      await pluginUploadService.handleUpdate(req, res);
    },
  );

  server.delete("/v1/plugins/:pluginId", withAdminAuth, async (req, res) => {
    await pluginUploadService.handleDelete(req, res);
  });

  // Plugin API routes - secure HTTP endpoints for plugins to call back to the server
  const pluginAPIRouter = await import("@server/routes/v1/plugin-api/index");
  server.use("/v1/plugin-api", pluginAPIRouter.default);

  // Create dynamic router with plugin routes (after plugins are loaded)
  const { createV1Router } = await import("@server/routes/v1");
  const dynamicRouter = createV1Router();

  // Add tRPC middleware with context
  // @ts-ignore - Express type definition mismatch between root and server node_modules
  server.use(
    "/v1",
    createExpressMiddleware({
      router: dynamicRouter,
      createContext,
    }),
  );

  // Create HTTP server
  const httpServer = createServer(server);

  // Initialize WebSocket server
  // If WS_PORT is different from PORT, run WebSocket on separate port
  if (config.server.wsPort !== config.server.port) {
    // await websocketService.initialize(config.server.wsPort);
  } else {
    await websocketService.initialize(httpServer);
  }

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

  httpServer.listen(config.server.port, async () => {
    logger.info({ port: config.server.port }, "Server is running");
    logger.info({ wsPort: config.server.wsPort }, "WebSocket server is running");

    // Start the orchestrator worker (subscribes to RabbitMQ queue)
    await orchestratorWorker.start();
    logger.info("Orchestrator worker started");

    // Initialize plugin pages management (plugin system already initialized)
    try {
      // Initialize plugin pages management
      const { pluginPagesService } = await import("./services/plugin-pages.service");
      await pluginPagesService.initialize();
      logger.info("Plugin pages synced with dashboard");

      // Start plugin route service cleanup
      pluginRouteService.startCleanup();
      logger.info("Plugin route service started");

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

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down gracefully");
    orchestratorWorker.stop();
    pluginInstanceManagerService.stopCleanup();
    websocketService.shutdown();
    await rabbitmqService.shutdown();
    await getPluginRunnerService().stopAllWorkers();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    logger.info("SIGINT received, shutting down gracefully");
    orchestratorWorker.stop();
    pluginInstanceManagerService.stopCleanup();
    websocketService.shutdown();
    await rabbitmqService.shutdown();
    await getPluginRunnerService().stopAllWorkers();
    process.exit(0);
  });
}

// Start the server
startServer().catch((error) => {
  logger.error({ err: error }, "Failed to start server");
  process.exit(1);
});
