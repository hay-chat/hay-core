import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import cors from "cors";
import { config } from "@/config/env";
import { appRouter } from "@/routes";
import { createContext } from "@/trpc/context";
import { initializeDatabase } from "@/database/data-source";
import "reflect-metadata";
import "dotenv/config";

async function startServer() {
  // Initialize database connection (optional)
  const dbConnected = await initializeDatabase();
  if (!dbConnected) {
    console.warn("⚠️  Starting server without database connection");
  }

  const server = express();

  // Add CORS middleware
  server.use(
    cors({
      origin:
        process.env.NODE_ENV === "production"
          ? ["https://hay.so", "https://hay.ai", "https://hay.local"]
          : [
              "http://localhost:3001",
              "http://localhost:5173",
              "http://localhost:4000",
              "http://127.0.0.1:3001",
              "http://127.0.0.1:4000",
            ],
      credentials: true,
    })
  );

  // Add JSON parsing middleware
  server.use(express.json());

  // Add tRPC middleware with context
  server.use(
    "/v1",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  server.listen(config.server.port, () => {
    console.log(`🚀 Server is running on port ${config.server.port}`);
  });
}

// Start the server
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  // Don't exit on error, just log it
});
