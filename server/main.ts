import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import cors from "cors";
import { config } from "@server/config/env";
import { appRouter } from "@server/routes";
import { createContext } from "@server/trpc/context";
import { initializeDatabase } from "@server/database/data-source";
import { orchestratorWorker } from "@server/workers/orchestrator.worker";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { processManagerService } from "@server/services/process-manager.service";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
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
        execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, {
          stdio: "ignore",
        });
      }
      console.log(`🛑 Killed any process running on port ${port}`);
    } catch (err) {
      // If no process is found, lsof/xargs/for will fail, which is fine
      // Only log if it's not the "no process found" error
      // (We ignore errors here to avoid blocking server start)
    }
  }

  server.listen(config.server.port, async () => {
    console.log(
      `🚀 Server is running on port http://localhost:${config.server.port}`
    );

    // Start the orchestrator worker if database is connected
    if (dbConnected) {
      orchestratorWorker.start(config.orchestrator.interval); // Check every second
      console.log("🤖 Orchestrator worker started");

      // Initialize plugin system
      try {
        await pluginManagerService.initialize();
        console.log("🔌 Plugin manager initialized");

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
    await processManagerService.stopAll();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("SIGINT received, shutting down gracefully");
    orchestratorWorker.stop();
    await processManagerService.stopAll();
    process.exit(0);
  });
}

// Start the server
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  // Don't exit on error, just log it
});
