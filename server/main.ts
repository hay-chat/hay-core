import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { config, validateProductionConfig } from "@server/config/env";
import { createContext } from "@server/trpc/context";
import { initializeDatabase } from "@server/database/data-source";
import "reflect-metadata";
import "dotenv/config";

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
    console.warn("⚠️  Starting server without Redis connection");
  }

  // Initialize Job Queue service (depends on Redis)
  const { jobQueueService } = await import("@server/services/job-queue.service");
  try {
    await jobQueueService.initialize();
  } catch (error) {
    console.warn("⚠️  Starting server without Job Queue service");
  }

  // Initialize Scheduler service (depends on Database)
  const { schedulerService } = await import("@server/services/scheduler.service");
  const { registerAllScheduledJobs } = await import("@server/services/scheduled-jobs.registry");
  try {
    await schedulerService.initialize();
    registerAllScheduledJobs();
  } catch (error) {
    console.warn("⚠️  Starting server without Scheduler service");
    console.error(error);
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

  // Add permissive CORS middleware for publicConversations endpoints
  // This allows the widget to be embedded on any domain
  server.use((req, res, next) => {
    // Check if the path starts with /v1/publicConversations
    if (req.path.startsWith("/v1/publicConversations")) {
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

  // Add JSON parsing middleware with increased size limit for document uploads
  server.use(express.json({ limit: "50mb" }));
  server.use(express.urlencoded({ extended: true, limit: "50mb" }));

  server.get("/", (req, res) => {
    res.send("Welcome to Hay");
  });

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
      setHeaders: (res, filePath) => {
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
  console.log(`📦 Serving webchat files from: ${webchatDir}`);
  server.use(
    "/webchat",
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

  // Plugin thumbnail route - serve thumbnail.jpg files
  // Use catch-all pattern to handle plugin IDs with slashes (e.g., @hay/plugin-name)
  server.get(/^\/plugins\/thumbnails\/(.+)$/, (req, res) => {
    // Set params manually for regex routes
    req.params = {
      pluginName: decodeURIComponent(req.params[0]),
    };
    pluginAssetService.serveThumbnail(req, res).catch((error) => {
      console.error("Thumbnail serving error:", error);
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin public directory route - serve any file from plugin's public folder
  server.get(/^\/plugins\/public\/([^/]+)\/(.*)$/, (req, res) => {
    // Set params manually for regex routes
    req.params = {
      pluginName: req.params[0],
      filePath: req.params[1],
    };
    pluginAssetService.servePublicFile(req, res).catch((error) => {
      console.error("Public file serving error:", error);
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin UI assets route - serve dist/ files (ui.js, etc.)
  // Pattern: /plugins/ui/:pluginName/:assetPath
  // Example: /plugins/ui/@hay/plugin-zendesk/ui.js
  // Note: Public endpoint - UI bundles are just JavaScript code with no secrets
  server.get(/^\/plugins\/ui\/([^/]+(?:\/[^/]+)?)\/(.+)$/, async (req, res) => {
    // Set params manually for regex routes
    // params[0] = pluginName (may contain slash for scoped packages like @hay/plugin-zendesk)
    // params[1] = assetPath (e.g., ui.js or images/screenshot.png)
    req.params = {
      pluginName: decodeURIComponent(req.params[0]),
      assetPath: req.params[1],
    };

    try {
      // Serve the file (no authentication required for UI bundles)
      await pluginAssetService.serveUIAsset(req, res);
    } catch (error) {
      console.error("UI asset serving error:", error);
      res.status(500).json({ error: "Failed to load UI asset" });
    }
  });

  // Plugin webhook routes - handle incoming webhooks from external services
  server.all(/^\/plugins\/webhooks\/([^/]+)\/(.*)$/, (req, res) => {
    // Set params manually for regex routes
    req.params = {
      pluginName: req.params[0],
      webhookPath: req.params[1],
    };
    pluginRouteService.handleWebhook(req, res).catch((error) => {
      console.error("Webhook handling error:", error);
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin webhook verification route - handle webhook verification challenges
  server.get("/plugins/webhooks/:pluginName", (req, res) => {
    pluginRouteService.handleWebhookVerification(req, res).catch((error) => {
      console.error("Webhook verification error:", error);
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin worker proxy route - proxy requests to plugin workers
  // This is for the new TypeScript-based plugin system with process isolation
  const pluginProxyRouter = require("@server/routes/v1/plugins/proxy").default;
  server.use("/v1/plugins", pluginProxyRouter);

  // OAuth callback route - handle OAuth redirects from providers
  server.get("/oauth/callback", async (req, res) => {
    console.log("\n========== OAUTH CALLBACK ENDPOINT HIT ==========");
    console.log("Full query params:", req.query);
    console.log("URL:", req.url);

    const { oauthService } = await import("@server/services/oauth.service");
    const { getDashboardUrl } = await import("@server/config/env");

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
        console.log("✅ OAuth successful, redirecting to:", redirectUrl);
        console.log("========== OAUTH CALLBACK ENDPOINT END ==========\n");
        return res.redirect(redirectUrl);
      } else {
        console.log("❌ OAuth failed, showing error page");
        console.log("========== OAUTH CALLBACK ENDPOINT END ==========\n");
        // Show error page
        return res.status(400).send(`
          <html>
            <head><title>OAuth Error</title></head>
            <body>
              <h1>OAuth Authorization Failed</h1>
              <p>${result.error || "Unknown error occurred"}</p>
              <a href="${getDashboardUrl()}">Return to Dashboard</a>
            </body>
          </html>
        `);
      }
    } catch (error) {
      console.error("❌ OAuth callback exception:", error);
      console.log("========== OAUTH CALLBACK ENDPOINT END ==========\n");
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

  // Well-known endpoints for OAuth Client Metadata Document (CIMD)
  const wellKnownRouter = await import("@server/routes/well-known");
  server.use(wellKnownRouter.default);

  // Initialize plugin system BEFORE creating the router
  try {
    await pluginManagerService.initialize();
    console.log("🔌 Plugin manager initialized");
  } catch (error) {
    console.error("Failed to initialize plugin system:", error);
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
    fileFilter: (req: any, file: any, cb: any) => {
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
      console.error(`❌ Port ${config.server.port} is already in use.`);
      process.exit(1);
    }
    console.error("Server error:", error);
    process.exit(1);
  });

  httpServer.listen(config.server.port, async () => {
    console.log(`🚀 Server is running on port http://localhost:${config.server.port}`);
    console.log(`🔌 WebSocket server is running on ws://localhost:${config.server.wsPort}/ws`);

    // Start the orchestrator worker
    orchestratorWorker.start(config.orchestrator.interval); // Check every second
    console.log("🤖 Orchestrator worker started");

    // Initialize plugin pages management (plugin system already initialized)
    try {
      // Initialize plugin pages management
      const { pluginPagesService } = await import("./services/plugin-pages.service");
      await pluginPagesService.initialize();
      console.log("📄 Plugin pages synced with dashboard");

      // Start plugin route service cleanup
      pluginRouteService.startCleanup();
      console.log("🔌 Plugin route service started");

      // Start plugin instance lifecycle management
      pluginInstanceManagerService.startCleanup();
      console.log("🔌 Plugin instance lifecycle manager started");

      // Note: Plugins will now be started on-demand when needed
      // This improves scalability and resource usage
      console.log(`🔌 Plugin system ready (on-demand instance startup enabled)`);
    } catch (error) {
      console.error("Failed to initialize plugin system:", error);
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down gracefully");
    orchestratorWorker.stop();
    pluginInstanceManagerService.stopCleanup();
    websocketService.shutdown();
    await getPluginRunnerService().stopAllWorkers();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("SIGINT received, shutting down gracefully");
    orchestratorWorker.stop();
    pluginInstanceManagerService.stopCleanup();
    websocketService.shutdown();
    await getPluginRunnerService().stopAllWorkers();
    process.exit(0);
  });
}

// Start the server
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
