import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
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
import { execSync } from "child_process";

/**
 * Initialize database connection
 */
export async function initDatabase() {
  const dbConnected = await initializeDatabase();
  if (!dbConnected) {
    console.warn("⚠️  Starting server without database connection");
  }
  return dbConnected;
}

/**
 * Setup common Express middleware for both server modes
 */
export function setupCommonMiddleware(app: express.Application) {
  // Add JSON parsing middleware with increased size limit for document uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
}

/**
 * Setup plugin routes (assets, webhooks, embed scripts)
 */
export function setupPluginRoutes(app: express.Application) {
  // Plugin asset routes - serve public assets like widget scripts
  app.get(/^\/plugins\/assets\/([^/]+)\/(.*)$/, (req, res) => {
    req.params = {
      pluginName: req.params[0],
      assetPath: req.params[1]
    };
    pluginAssetService.serveAsset(req, res).catch((error) => {
      console.error("Asset serving error:", error);
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin embed script route
  app.get("/plugins/embed/:organizationId/:pluginId", async (req, res) => {
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

  // Plugin webhook routes
  app.all(/^\/plugins\/webhooks\/([^/]+)\/(.*)$/, (req, res) => {
    req.params = {
      pluginName: req.params[0],
      webhookPath: req.params[1]
    };
    pluginRouteService.handleWebhook(req, res).catch((error) => {
      console.error("Webhook handling error:", error);
      res.status(500).json({ error: "Internal server error" });
    });
  });

  // Plugin webhook verification route
  app.get("/plugins/webhooks/:pluginName", (req, res) => {
    pluginRouteService.handleWebhookVerification(req, res).catch((error) => {
      console.error("Webhook verification error:", error);
      res.status(500).json({ error: "Internal server error" });
    });
  });
}

/**
 * Setup tRPC API routes
 */
export function setupApiRoutes(app: express.Application) {
  app.use(
    "/v1",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
}

/**
 * Kill process on port (development only)
 */
export function killPortProcess(port: number) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  try {
    if (process.platform === "win32") {
      // Windows: find and kill process using the port
      execSync(
        `for /f "tokens=5" %a in ('netstat -aon ^| find ":${port}" ^| find "LISTENING"') do taskkill /F /PID %a`,
        { stdio: "ignore" }
      );
    } else {
      // Unix/macOS: find and kill process using the port
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

/**
 * Handle server errors
 */
export function handleServerError(httpServer: ReturnType<typeof createServer>) {
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${config.server.port} is already in use.`);
      console.log('🔄 Attempting to kill the process and retry...');
      
      // Try to kill the process again
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
}

/**
 * Initialize background services (orchestrator, plugins)
 */
export async function initializeBackgroundServices(dbConnected: boolean) {
  if (!dbConnected) {
    return;
  }

  orchestratorWorker.start(config.orchestrator.interval);
  console.log("🤖 Orchestrator worker started");

  try {
    await pluginManagerService.initialize();
    console.log("🔌 Plugin manager initialized");

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

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown() {
  const shutdown = async () => {
    console.log("Shutting down gracefully");
    orchestratorWorker.stop();
    websocketService.shutdown();
    await processManagerService.stopAll();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

/**
 * Create and configure HTTP server
 */
export function createHttpServer(app: express.Application): ReturnType<typeof createServer> {
  const httpServer = createServer(app);
  
  // Initialize WebSocket server
  websocketService.initialize(httpServer);
  
  // Setup error handling
  handleServerError(httpServer);
  
  return httpServer;
}

/**
 * Start the HTTP server
 */
export async function startHttpServer(
  httpServer: ReturnType<typeof createServer>,
  dbConnected: boolean,
  serverName: string = "Server"
) {
  return new Promise<void>((resolve) => {
    httpServer.listen(config.server.port, async () => {
      console.log(
        `🚀 ${serverName} is running on http://localhost:${config.server.port}`
      );
      console.log(
        `🔌 WebSocket server is running on ws://localhost:${config.server.port}/ws`
      );
      
      if (serverName === "Unified server") {
        console.log(
          `📡 API available at http://localhost:${config.server.port}/v1`
        );
      }

      // Initialize background services
      await initializeBackgroundServices(dbConnected);
      
      resolve();
    });
  });
}