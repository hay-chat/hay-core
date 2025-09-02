import express from "express";
import cors from "cors";
import { config } from "@server/config/env";
import {
  initDatabase,
  setupCommonMiddleware,
  setupPluginRoutes,
  setupApiRoutes,
  killPortProcess,
  createHttpServer,
  startHttpServer,
  setupGracefulShutdown
} from "@server/server-utils";
import "reflect-metadata";
import "dotenv/config";

async function startServer() {
  // Check if we should run in unified mode
  if (config.server.unifiedMode) {
    console.log("🔄 Unified mode detected, starting unified server...");
    // Import and run the unified server instead
    require("./unified");
    return;
  }

  // Set server timezone to UTC for consistent timestamp handling
  process.env.TZ = 'UTC';
  console.log(`🌍 Server timezone set to UTC`);
  
  // Initialize database connection
  const dbConnected = await initDatabase();

  const app = express();

  // Add CORS middleware for separate mode
  app.use(
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

  // Setup common middleware
  setupCommonMiddleware(app);

  // Setup plugin routes
  setupPluginRoutes(app);

  // Setup API routes
  setupApiRoutes(app);

  // Kill any process using the port in development mode
  killPortProcess(config.server.port);

  // Create HTTP server
  const httpServer = createHttpServer(app);

  // Start the server
  await startHttpServer(httpServer, dbConnected, "Server");

  // Setup graceful shutdown
  setupGracefulShutdown();
}

// Start the server
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  // Don't exit on error, just log it
});