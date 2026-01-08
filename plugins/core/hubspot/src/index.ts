/**
 * HubSpot Plugin
 *
 * Connect your HubSpot CRM to access and manage contacts, companies, deals,
 * tickets, and other CRM objects through HubSpot's Model Context Protocol server.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

export default defineHayPlugin((globalCtx) => ({
  name: "HubSpot",

  /**
   * Global initialization - register config and auth
   */
  onInitialize(ctx) {
    globalCtx.logger.info("Initializing HubSpot plugin");

    // Register config fields for OAuth client credentials
    ctx.register.config({
      clientId: {
        type: "string",
        label: "OAuth Client ID",
        description: "HubSpot OAuth client ID",
        required: true,
        encrypted: false,
        env: "HUBSPOT_CLIENT_ID",
      },
      clientSecret: {
        type: "string",
        label: "OAuth Client Secret",
        description: "HubSpot OAuth client secret",
        required: true,
        encrypted: true,
        env: "HUBSPOT_CLIENT_SECRET",
      },
    });

    // Register OAuth2 authentication method
    ctx.register.auth.oauth2({
      id: "hubspot-oauth",
      label: "HubSpot OAuth",
      authorizationUrl: "https://mcp.hubspot.com/oauth/authorize",
      tokenUrl: "https://mcp.hubspot.com/oauth/v1/token",
      scopes: [
        "crm.objects.tickets.read",
        "crm.objects.deals.read",
        "crm.objects.companies.read",
        "crm.objects.contacts.read",
        "oauth",
        // Optional/additional scopes
        "crm.objects.tickets.write",
        "crm.objects.owners.read",
        "crm.lists.read",
        "crm.objects.products.write",
        "crm.objects.subscriptions.read",
        "crm.objects.emails.write",
        "crm.objects.orders.read",
        "crm.objects.meetings.write",
        "crm.objects.invoices.read",
        "crm.objects.companies.write",
        "crm.objects.tasks.read",
        "crm.objects.notes.write",
        "crm.objects.deals.write",
        "crm.objects.calls.write",
        "crm.objects.line_items.write",
        "crm.objects.contacts.write",
        "crm.objects.line_items.read",
        "crm.objects.calls.read",
        "crm.objects.meetings.read",
        "crm.objects.users.read",
        "crm.objects.carts.read",
        "crm.objects.emails.read",
        "crm.objects.quotes.read",
        "crm.objects.notes.read",
        "crm.objects.products.read",
        "crm.objects.tasks.write",
      ],
      clientId: ctx.config.field("clientId"),
      clientSecret: ctx.config.field("clientSecret"),
    });

    globalCtx.logger.info("HubSpot OAuth authentication registered");
  },

  /**
   * Validate authentication credentials
   */
  async onValidateAuth(ctx) {
    ctx.logger.info("Validating HubSpot auth credentials");

    const authState = ctx.auth.get();
    if (!authState) {
      throw new Error("No authentication configured");
    }

    // For OAuth2, check if we have an access token
    // If not present, validation still passes - user needs to complete OAuth flow
    if (authState.credentials.accessToken) {
      ctx.logger.info("HubSpot auth validation successful - access token present");
    } else {
      ctx.logger.info("HubSpot auth configuration saved - OAuth flow required to get access token");
    }

    return true;
  },

  /**
   * Org runtime initialization - connect to HubSpot MCP server
   */
  async onStart(ctx) {
    ctx.logger.info("Starting HubSpot plugin for org", { orgId: ctx.org.id });

    try {
      // Get auth state
      const authState = ctx.auth.get();
      if (!authState) {
        throw new Error("No authentication configured for HubSpot plugin");
      }

      // Log auth state details for debugging
      ctx.logger.debug("Auth state retrieved", {
        methodId: authState.methodId,
        hasAccessToken: !!authState.credentials.accessToken,
        credentialKeys: Object.keys(authState.credentials),
      });

      // Build auth headers
      const authHeaders: Record<string, string> = {};
      if (authState.credentials.accessToken) {
        const token = authState.credentials.accessToken as string;
        authHeaders["Authorization"] = `Bearer ${token}`;
        ctx.logger.info("✅ Authorization header added", {
          tokenPreview: token.substring(0, 20) + "...",
          tokenLength: token.length,
        });
      } else {
        ctx.logger.error(
          "❌ No access token found in auth state - MCP server connection will fail",
          {
            credentials: authState.credentials,
          },
        );
      }

      // Connect to external MCP server
      await ctx.mcp.startExternal({
        id: "hubspot-mcp",
        url: "https://mcp.hubspot.com",
        authHeaders,
      });

      ctx.logger.info("HubSpot MCP server connected successfully");
    } catch (error) {
      ctx.logger.error("Failed to connect to HubSpot MCP server:", error);
      throw error;
    }
  },

  /**
   * Config update handler
   */
  async onConfigUpdate(ctx) {
    ctx.logger.info("HubSpot plugin config updated");
    // Config changes (client ID/secret) will take effect on restart
  },

  /**
   * Disable handler - cleanup
   */
  async onDisable(ctx) {
    ctx.logger.info("HubSpot plugin disabled for org", { orgId: ctx.org.id });
    // MCP servers are stopped automatically by the SDK
  },

  /**
   * Enable handler - called by core when plugin is enabled
   * Note: This is a CORE-ONLY hook, receives global context (not org context)
   */
  async onEnable(ctx) {
    ctx.logger.info("HubSpot plugin enabled");
    // Plugin will be restarted via onStart automatically for each org
  },
}));
