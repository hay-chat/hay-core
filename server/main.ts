import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { config } from "@server/config/env";
import { appRouter } from "@server/routes";
import { createContext } from "@server/trpc/context";
import { initializeDatabase } from "@server/database/data-source";
import { orchestratorWorker } from "@server/workers/orchestrator.worker";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { processManagerService } from "@server/services/process-manager.service";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { pluginAssetService } from "@server/services/plugin-asset.service";
import { pluginRouteService } from "@server/services/plugin-route.service";
import { websocketService } from "@server/services/websocket.service";
import "reflect-metadata";
import "dotenv/config";

async function startServer() {
  // Set server timezone to UTC for consistent timestamp handling
  process.env.TZ = 'UTC';
  console.log(`🌍 Server timezone set to UTC`);
  
  // Initialize database connection (optional)
  const dbConnected = await initializeDatabase();
  if (!dbConnected) {
    console.warn("⚠️  Starting server without database connection");
  }

  const server = express();

  // Add CORS middleware with proper configuration
  server.use(
    cors({
      origin: config.cors.origin,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-organization-id"],
      exposedHeaders: ["Content-Range", "X-Total-Count"],
      maxAge: 86400,
      optionsSuccessStatus: 204,
    })
  );

  // Add JSON parsing middleware with increased size limit for document uploads
  server.use(express.json({ limit: "50mb" }));
  server.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Plugin asset routes - serve public assets like widget scripts
  server.get(/^\/plugins\/assets\/([^/]+)\/(.*)$/, (req, res) => {
    // Set params manually for regex routes
    req.params = {
      pluginName: req.params[0],
      assetPath: req.params[1]
    };
    pluginAssetService.serveAsset(req, res).catch((error) => {
      console.error("Asset serving error:", error);
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin embed script route - generate embed code for websites
  server.get("/plugins/embed/:organizationId/:pluginId", async (req, res) => {
    try {
      const script = await pluginAssetService.generateEmbedScript(
        req.params.organizationId,
        req.params.pluginId
      );
      res.setHeader("Content-Type", "application/javascript");
      res.send(script);
    } catch (error) {
      console.error("Embed script error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Plugin webhook routes - handle incoming webhooks from external services
  server.all(/^\/plugins\/webhooks\/([^/]+)\/(.*)$/, (req, res) => {
    // Set params manually for regex routes
    req.params = {
      pluginName: req.params[0],
      webhookPath: req.params[1]
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

  // Add tRPC middleware with context
  server.use(
    "/v1",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Create HTTP server
  const httpServer = createServer(server);

  // Initialize WebSocket server
  // If WS_PORT is different from PORT, run WebSocket on separate port
  if (config.server.wsPort !== config.server.port) {
    websocketService.initialize(config.server.wsPort);
  } else {
    websocketService.initialize(httpServer);
  }

  httpServer.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${config.server.port} is already in use.`);
      process.exit(1);
    }
    console.error('Server error:', error);
    process.exit(1);
  });

  httpServer.listen(config.server.port, async () => {
    console.log(
      `🚀 Server is running on port http://localhost:${config.server.port}`
    );
    console.log(
      `🔌 WebSocket server is running on ws://localhost:${config.server.wsPort}/ws`
    );

    // Start the orchestrator worker if database is connected
    if (dbConnected) {
      orchestratorWorker.start(config.orchestrator.interval); // Check every second
      console.log("🤖 Orchestrator worker started");

      // Initialize plugin system
      try {
        await pluginManagerService.initialize();
        console.log("🔌 Plugin manager initialized");

        // Start plugin route service cleanup
        pluginRouteService.startCleanup();
        console.log("🔌 Plugin route service started");

        // Start enabled plugins for all organizations
        const enabledInstances = await pluginInstanceRepository.findAll({
          where: { enabled: true },
          relations: ["plugin"],
        });

        for (const instance of enabledInstances) {
          try {
            await processManagerService.startPlugin(
              instance.organizationId,
              instance.pluginId
            );
          } catch (error) {
            console.error(
              `Failed to start plugin ${instance.plugin.name} for org ${instance.organizationId}:`,
              error
            );
          }
        }

        console.log(`🔌 Started ${enabledInstances.length} plugin instances`);
      } catch (error) {
        console.error("Failed to initialize plugin system:", error);
      }
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down gracefully");
    orchestratorWorker.stop();
    websocketService.shutdown();
    await processManagerService.stopAll();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("SIGINT received, shutting down gracefully");
    orchestratorWorker.stop();
    websocketService.shutdown();
    await processManagerService.stopAll();
    process.exit(0);
  });
}

// Start the server
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});