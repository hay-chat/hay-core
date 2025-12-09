import { HayPlugin, startPluginWorker, type RouteHandler } from "@hay/plugin-sdk";

/**
 * Simple HTTP Test Plugin
 *
 * This plugin validates the core plugin infrastructure with basic HTTP routes.
 * It does NOT use MCP capabilities - this is a pure HTTP plugin for testing:
 * - Process isolation
 * - Port allocation
 * - Route proxy forwarding
 * - JWT authentication
 * - Worker lifecycle management
 */
class SimpleHttpTestPlugin extends HayPlugin {
  constructor() {
    super({
      id: "simple-http-test",
      name: "Simple HTTP Test Plugin",
      version: "1.0.0",
      description: "Test plugin to validate plugin infrastructure",
      capabilities: ["routes"], // Only HTTP routes, no MCP
    });
  }

  async onInitialize(): Promise<void> {
    console.log("[SimpleHttpTest] Initializing plugin...");

    // Register test routes
    this.registerRoute("GET", "/ping", this.handlePing.bind(this));
    this.registerRoute("POST", "/echo", this.handleEcho.bind(this));
    this.registerRoute("GET", "/config", this.handleConfig.bind(this));
    this.registerRoute("GET", "/headers", this.handleHeaders.bind(this));

    console.log("[SimpleHttpTest] Plugin initialized successfully");
    console.log("[SimpleHttpTest] Available routes:");
    console.log("  - GET  /ping     - Simple ping/pong response");
    console.log("  - POST /echo     - Echo back request body");
    console.log("  - GET  /config   - Show plugin configuration (safe fields only)");
    console.log("  - GET  /headers  - Show request headers");
  }

  /**
   * Simple ping endpoint
   */
  private handlePing: RouteHandler = async (req, res) => {
    res.json({
      success: true,
      message: "pong",
      timestamp: new Date().toISOString(),
      pluginId: this.metadata.id,
      pluginVersion: this.metadata.version,
    });
  };

  /**
   * Echo endpoint - returns request body
   */
  private handleEcho: RouteHandler = async (req, res) => {
    res.json({
      success: true,
      echo: req.body,
      timestamp: new Date().toISOString(),
      headers: {
        contentType: req.headers["content-type"],
        authorization: req.headers["authorization"] ? "***" : undefined,
      },
    });
  };

  /**
   * Config endpoint - shows safe configuration fields
   */
  private handleConfig: RouteHandler = async (req, res) => {
    res.json({
      success: true,
      metadata: {
        id: this.metadata.id,
        name: this.metadata.name,
        version: this.metadata.version,
        capabilities: this.metadata.capabilities,
      },
      environment: {
        hasApiUrl: !!process.env.HAY_API_URL,
        hasApiToken: !!process.env.HAY_API_TOKEN,
      },
    });
  };

  /**
   * Headers endpoint - shows all request headers
   */
  private handleHeaders: RouteHandler = async (req, res) => {
    // Redact sensitive headers
    const headers = { ...req.headers };
    if (headers.authorization) {
      headers.authorization = "Bearer ***";
    }

    res.json({
      success: true,
      headers,
      timestamp: new Date().toISOString(),
    });
  };
}

// Start the plugin worker
startPluginWorker(SimpleHttpTestPlugin);
