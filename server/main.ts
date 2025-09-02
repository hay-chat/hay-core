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
      origin: "http://localhost:5173",
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
  server.get(/^\/plugins\/assets\/([^\/]+)\/(.*)$/, (req, res) => {
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
  server.all(/^\/plugins\/webhooks\/([^\/]+)\/(.*)$/, (req, res) => {
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

  // Before starting the server, attempt to kill any process using the same port.
  // This is a destructive operation, so let's discuss the implications:
  // - This will forcibly terminate any process (not just Node) using the configured port.
  // - This is generally safe in local/dev environments, but should be avoided in production.
  // - We'll use 'child_process' to execute a platform-specific command.
  // - If the port is not in use, the command will have no effect.

  // Only run this in development mode for safety.
  if (process.env.NODE_ENV === "development") {
    const { execSync } = require("child_process");
    const port = config.server.port;

    try {
      if (process.platform === "win32") {
        // Windows: find and kill process using the port
        execSync(
          `for /f "tokens=5" %a in ('netstat -aon ^| find ":${port}" ^| find "LISTENING"') do taskkill /F /PID %a`,
          { stdio: "ignore" }
        );
      } else {
        // Unix/macOS: find and kill process using the port
        // Note: macOS doesn't support xargs -r, so we handle it differently
        try {
          const pids = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8' }).trim();
          if (pids) {
            execSync(`kill -9 ${pids.split('\n').join(' ')}`, { stdio: "ignore" });
            console.log(`🛑 Killed process(es) running on port ${port}: ${pids.replace(/\n/g, ', ')}`);
          }
        } catch (lsofErr) {
          // No process found on port, which is fine
        }
      }
    } catch (err: any) {
      // If no process is found, the command will fail, which is fine
      // Only log unexpected errors
      if (err.message && !err.message.includes('No such process')) {
        console.log(`⚠️ Port cleanup warning: ${err.message}`);
      }
    }
  }

  // Create HTTP server
  const httpServer = createServer(server);

  // Initialize WebSocket server
  websocketService.initialize(httpServer);

  httpServer.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${config.server.port} is already in use.`);
      console.log('🔄 Attempting to kill the process and retry...');
      
      // Try to kill the process again
      const { execSync } = require("child_process");
      try {
        if (process.platform !== "win32") {
          const pids = execSync(`lsof -ti tcp:${config.server.port}`, { encoding: 'utf-8' }).trim();
          if (pids) {
            execSync(`kill -9 ${pids.split('\n').join(' ')}`, { stdio: "ignore" });
            console.log(`✅ Killed process(es): ${pids.replace(/\n/g, ', ')}`);
            
            // Wait a moment and retry
            setTimeout(() => {
              httpServer.listen(config.server.port);
            }, 1000);
            return;
          }
        }
      } catch (err) {
        console.error('❌ Failed to kill process. Please manually kill the process using port', config.server.port);
      }
    }
    console.error('Server error:', error);
    process.exit(1);
  });

  httpServer.listen(config.server.port, async () => {
    console.log(
      `🚀 Server is running on port http://localhost:${config.server.port}`
    );
    console.log(
      `🔌 WebSocket server is running on ws://localhost:${config.server.port}/ws`
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
  // Don't exit on error, just log it
});
