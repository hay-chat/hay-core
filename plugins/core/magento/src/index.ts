import { defineHayPlugin } from "@hay/plugin-sdk";

/**
 * Magento Plugin
 *
 * Connect your Magento 2 e-commerce store to manage products, orders, customers,
 * inventory, and analyze sales performance through Magento's REST API
 */
export default defineHayPlugin((globalCtx) => ({
  name: "Magento",

  /**
   * Global initialization - register config and auth methods
   */
  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Magento plugin");

    // Register configuration fields
    ctx.register.config({
      baseUrl: {
        type: "string",
        label: "Magento Base URL",
        description: "Your Magento 2 REST API base URL (e.g., https://yourdomain.com/rest/V1)",
        required: true,
        encrypted: false,
      },
      apiToken: {
        type: "string",
        label: "API Token",
        description: "Magento API token (create in System > Integrations)",
        required: true,
        encrypted: true,
      },
    });

    // Register API Key authentication (uses apiToken field)
    ctx.register.auth.apiKey({
      id: "magento-apikey",
      label: "Magento API Token",
      configField: "apiToken",
    });

    globalCtx.logger.info("Magento plugin config and auth methods registered");
  },

  /**
   * Validate authentication credentials
   */
  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Magento credentials");

    const baseUrl = ctx.config.get<string>("baseUrl");
    const apiToken = ctx.config.get<string>("apiToken");

    // Basic validation
    if (!baseUrl || !apiToken) {
      throw new Error("Base URL and API token are required");
    }

    // Validate base URL format
    try {
      const url = new URL(baseUrl);
      if (!url.protocol.startsWith("http")) {
        throw new Error("Base URL must use HTTP or HTTPS protocol");
      }
    } catch {
      throw new Error(
        "Invalid base URL format - must be a valid URL (e.g., https://yourdomain.com/rest/V1)",
      );
    }

    // Test actual Magento API connection by fetching store config
    try {
      const testUrl = `${baseUrl}/store/storeConfigs`;

      const response = await fetch(testUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        ctx.logger.error("Magento API authentication failed", {
          status: response.status,
          error: errorText,
        });

        if (response.status === 401) {
          throw new Error("Invalid API token - please check your credentials");
        } else if (response.status === 404) {
          throw new Error("Magento REST API not found - please verify the base URL is correct");
        } else {
          throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }
      }

      ctx.logger.info("Magento credentials validated successfully");
      return true;
    } catch (error: any) {
      ctx.logger.error("Failed to validate Magento credentials", { error: error.message });

      // Re-throw validation errors as-is
      if (
        error.message.includes("credentials") ||
        error.message.includes("not found") ||
        error.message.includes("API request failed")
      ) {
        throw error;
      }

      // Network or other errors
      throw new Error(`Failed to connect to Magento: ${error.message}`);
    }
  },

  /**
   * Org runtime initialization - start local MCP server
   */
  async onStart(ctx) {
    ctx.logger.info("Starting Magento plugin for org", { orgId: ctx.org.id });

    // Check if credentials are configured before starting MCP server
    const baseUrl = ctx.config.getOptional<string>("baseUrl");
    const apiToken = ctx.config.getOptional<string>("apiToken");

    if (!baseUrl || !apiToken) {
      ctx.logger.info(
        "Magento credentials not configured - plugin is enabled but MCP tools are not available. " +
          "Please configure your Magento credentials in the plugin settings.",
      );
      return;
    }

    try {
      // Start local MCP server with credentials using SDK's stdio method
      await ctx.mcp.startLocalStdio({
        id: "magento-mcp",
        command: "node",
        args: ["mcp-server.js"],
        cwd: "./mcp",
        env: {
          MAGENTO_BASE_URL: baseUrl,
          MAGENTO_API_TOKEN: apiToken,
        },
      });

      ctx.logger.info("Magento local MCP server started successfully");
    } catch (error) {
      ctx.logger.error("Failed to start Magento MCP server:", error);
      throw error;
    }
  },

  /**
   * Config update handler
   */
  async onConfigUpdate(ctx) {
    ctx.logger.info("Magento plugin config updated");
    // Config changes will take effect on next restart
  },

  /**
   * Disable handler - cleanup
   */
  async onDisable(ctx) {
    ctx.logger.info("Magento plugin disabled for org", { orgId: ctx.org.id });
    // MCP servers are stopped automatically by the SDK
  },

  /**
   * Enable handler
   */
  async onEnable(ctx) {
    ctx.logger.info("Magento plugin enabled");
    // Plugin will be restarted via onStart automatically for each org
  },
}));
