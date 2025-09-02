import express from "express";
import path from "path";
import fs from "fs";
import {
  initDatabase,
  setupCommonMiddleware,
  setupPluginRoutes,
  setupApiRoutes,
  createHttpServer,
  startHttpServer,
  setupGracefulShutdown
} from "@server/server-utils";
import "reflect-metadata";
import "dotenv/config";

async function startUnifiedServer() {
  // Set server timezone to UTC for consistent timestamp handling
  process.env.TZ = 'UTC';
  console.log(`🌍 Server timezone set to UTC`);
  console.log(`🔄 Starting in UNIFIED MODE - Frontend and Backend on single port`);
  
  // Initialize database connection
  const dbConnected = await initDatabase();

  const app = express();

  // Setup common middleware
  setupCommonMiddleware(app);

  // Setup plugin routes
  setupPluginRoutes(app);

  // Setup API routes
  setupApiRoutes(app);

  // Serve Nuxt app in unified mode
  const nuxtOutputPath = path.join(__dirname, "../dashboard/.output");
  const nuxtPublicPath = path.join(nuxtOutputPath, "public");
  const nuxtServerPath = path.join(nuxtOutputPath, "server");

  if (fs.existsSync(nuxtOutputPath)) {
    console.log("📦 Found Nuxt build output, serving frontend from Express");

    // Serve static assets from Nuxt's public directory
    if (fs.existsSync(nuxtPublicPath)) {
      app.use("/_nuxt", express.static(path.join(nuxtPublicPath, "_nuxt")));
      app.use("/", express.static(nuxtPublicPath, {
        index: false // Don't serve index.html as static
      }));
    }

    // Import and use Nuxt's server handler for SSR/SPA
    const nuxtIndexPath = path.join(nuxtServerPath, "index.mjs");
    if (fs.existsSync(nuxtIndexPath)) {
      // Dynamically import the Nuxt handler
      import(nuxtIndexPath).then(({ handler }) => {
        // Use Nuxt handler for all other routes (must be last)
        app.use(handler as express.Handler);
        console.log("✅ Nuxt handler integrated for frontend routing");
      }).catch((error) => {
        console.error("❌ Failed to load Nuxt handler:", error);
        // Fallback to serving index.html for SPA mode
        app.get("*", (_req, res) => {
          const indexPath = path.join(nuxtPublicPath, "index.html");
          if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
          } else {
            res.status(404).send("Frontend not found. Please build the dashboard first.");
          }
        });
      });
    } else {
      // Fallback for SPA mode without server handler
      app.get("*", (_req, res) => {
        const indexPath = path.join(nuxtPublicPath, "index.html");
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send("Frontend not found. Please build the dashboard first.");
        }
      });
    }
  } else {
    console.warn("⚠️  No Nuxt build found. Run 'npm run build:unified' first.");
    app.get("/", (_req, res) => {
      res.send(`
        <h1>Unified Server Running</h1>
        <p>Frontend not built yet. Please run:</p>
        <pre>npm run build:unified</pre>
        <p>API is available at <a href="/v1">/v1</a></p>
      `);
    });
  }

  // Create HTTP server
  const httpServer = createHttpServer(app);

  // Start the server
  await startHttpServer(httpServer, dbConnected, "Unified server");

  // Setup graceful shutdown
  setupGracefulShutdown();
}

// Start the unified server
startUnifiedServer().catch((error) => {
  console.error("Failed to start unified server:", error);
  process.exit(1);
});