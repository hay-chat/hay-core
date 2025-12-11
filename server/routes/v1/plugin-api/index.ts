import { Router, Request, Response, NextFunction } from "express";
import { PluginAPIService } from "../../../services/plugin-api/plugin-api.service";
import type {
  PluginAPITokenPayload,
  PluginAPIHttpResponse,
  SendEmailHttpRequest,
  SendEmailHttpResponse,
} from "../../../types/plugin-api.types";
import { debugLog } from "../../../lib/debug-logger";
import { mcpRegistryService } from "../../../services/mcp-registry.service";
import { pluginInstanceRepository } from "../../../repositories/plugin-instance.repository";

const router = Router();
const pluginAPIService = PluginAPIService.getInstance();

/**
 * Authentication middleware for Plugin API
 * Validates JWT token and attaches decoded payload to request
 */
interface AuthenticatedRequest extends Request {
  pluginAuth?: PluginAPITokenPayload;
}

const authenticatePlugin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: "Missing or invalid authorization header",
    } as PluginAPIHttpResponse);
    return;
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix
  const payload = pluginAPIService.validateToken(token);

  if (!payload) {
    res.status(401).json({
      success: false,
      error: "Invalid or expired token",
    } as PluginAPIHttpResponse);
    return;
  }

  req.pluginAuth = payload;
  console.log("[Plugin API Auth] Token payload:", JSON.stringify(payload, null, 2));
  next();
};

/**
 * POST /v1/plugin-api/send-email
 * Send email using platform's email service
 *
 * Requires:
 * - Valid JWT token in Authorization header
 * - Plugin must have "email" capability
 */
router.post(
  "/send-email",
  authenticatePlugin,
  async (req: AuthenticatedRequest, res: Response) => {
    const pluginAuth = req.pluginAuth!; // Safe because authenticatePlugin middleware guarantees this
    const emailRequest = req.body as SendEmailHttpRequest;

    // Validate request body
    if (!emailRequest.subject) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: subject",
      } as PluginAPIHttpResponse);
    }

    if (!emailRequest.body && !emailRequest.html) {
      return res.status(400).json({
        success: false,
        error: "Must provide either body (text) or html",
      } as PluginAPIHttpResponse);
    }

    try {
      debugLog("plugin-api", "Received send-email request", {
        pluginId: pluginAuth.pluginId,
        organizationId: pluginAuth.organizationId,
        subject: emailRequest.subject,
        hasTo: !!emailRequest.to,
        hasText: !!emailRequest.body,
        hasHtml: !!emailRequest.html,
      });

      // Call service to send email
      const result = await pluginAPIService.sendEmail(pluginAuth, {
        to: emailRequest.to,
        subject: emailRequest.subject,
        text: emailRequest.body,
        html: emailRequest.html,
        cc: emailRequest.cc,
        bcc: emailRequest.bcc,
      });

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error || "Failed to send email",
        } as PluginAPIHttpResponse);
      }

      return res.status(200).json({
        success: true,
        data: {
          messageId: result.messageId,
          recipients: Array.isArray(emailRequest.to)
            ? emailRequest.to
            : emailRequest.to
              ? [emailRequest.to]
              : [],
        } as SendEmailHttpResponse,
      } as PluginAPIHttpResponse<SendEmailHttpResponse>);
    } catch (error) {
      debugLog("plugin-api", "Error in send-email endpoint", {
        level: "error",
        pluginId: pluginAuth.pluginId,
        organizationId: pluginAuth.organizationId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      } as PluginAPIHttpResponse);
    }
  },
);

/**
 * GET /v1/plugin-api/health
 * Health check endpoint for plugins to verify API connectivity
 */
router.get(
  "/health",
  authenticatePlugin,
  (req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        pluginId: req.pluginAuth!.pluginId,
        organizationId: req.pluginAuth!.organizationId,
        capabilities: req.pluginAuth!.capabilities,
      },
    } as PluginAPIHttpResponse);
  },
);

/**
 * POST /v1/plugin-api/mcp/register-local
 * Register a local MCP server with tools
 *
 * Requires:
 * - Valid JWT token in Authorization header
 * - Plugin must have "mcp" capability
 */
router.post(
  "/mcp/register-local",
  authenticatePlugin,
  async (req: AuthenticatedRequest, res: Response) => {
    const pluginAuth = req.pluginAuth!;

    // Check MCP capability
    if (!pluginAuth.capabilities.includes("mcp")) {
      return res.status(403).json({
        success: false,
        error: "Plugin does not have 'mcp' capability",
      } as PluginAPIHttpResponse);
    }

    const { serverPath, startCommand, installCommand, buildCommand, tools, env, serverId } = req.body;

    // Validate required fields (tools is optional - will be discovered from MCP server)
    if (!serverPath || !startCommand) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: serverPath, startCommand",
      } as PluginAPIHttpResponse);
    }

    // If tools provided, validate it's an array
    if (tools !== undefined && !Array.isArray(tools)) {
      return res.status(400).json({
        success: false,
        error: "tools must be an array if provided",
      } as PluginAPIHttpResponse);
    }

    try {
      const organizationId = pluginAuth.organizationId;
      const pluginId = pluginAuth.pluginId;
      const finalServerId = serverId || `mcp-${Date.now()}`;

      debugLog("plugin-api", "Registering local MCP server", {
        organizationId,
        pluginId,
        serverId: finalServerId,
        toolCount: tools?.length || 0,
        toolsProvided: !!tools,
      });

      // Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        return res.status(404).json({
          success: false,
          error: `Plugin instance not found for ${organizationId}:${pluginId}`,
        } as PluginAPIHttpResponse);
      }

      // Update config with MCP server definition
      const config = instance.config || {};
      if (!config.mcpServers) {
        config.mcpServers = { local: [], remote: [] };
      }

      const mcpServers = config.mcpServers as any;
      mcpServers.local = mcpServers.local || [];

      // Check for duplicate serverId
      if (mcpServers.local.some((s: any) => s.serverId === finalServerId)) {
        return res.status(400).json({
          success: false,
          error: `MCP server with ID '${finalServerId}' already registered`,
        } as PluginAPIHttpResponse);
      }

      // Add MCP server config
      mcpServers.local.push({
        serverId: finalServerId,
        serverPath,
        startCommand,
        installCommand,
        buildCommand,
        tools,
        env,
      });

      // Save to database
      await pluginInstanceRepository.updateConfig(instance.id, config);

      // Register tools in registry (only if tools provided)
      if (tools && tools.length > 0) {
        await mcpRegistryService.registerTools(organizationId, pluginId, finalServerId, tools);
      }

      debugLog("plugin-api", "Local MCP server registered successfully", {
        organizationId,
        pluginId,
        serverId: finalServerId,
        toolsRegistered: tools.length,
      });

      return res.status(200).json({
        success: true,
        data: {
          serverId: finalServerId,
          toolsRegistered: tools.length,
        },
      } as PluginAPIHttpResponse);
    } catch (error) {
      debugLog("plugin-api", "Error registering local MCP server", {
        level: "error",
        pluginId: pluginAuth.pluginId,
        organizationId: pluginAuth.organizationId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      } as PluginAPIHttpResponse);
    }
  },
);

/**
 * POST /v1/plugin-api/mcp/register-remote
 * Register a remote MCP server with tools
 *
 * Requires:
 * - Valid JWT token in Authorization header
 * - Plugin must have "mcp" capability
 */
router.post(
  "/mcp/register-remote",
  authenticatePlugin,
  async (req: AuthenticatedRequest, res: Response) => {
    const pluginAuth = req.pluginAuth!;

    // Check MCP capability
    if (!pluginAuth.capabilities.includes("mcp")) {
      return res.status(403).json({
        success: false,
        error: "Plugin does not have 'mcp' capability",
      } as PluginAPIHttpResponse);
    }

    const { url, transport, auth, tools, serverId } = req.body;

    // Validate required fields (tools is optional - will be discovered from MCP server)
    if (!url || !transport) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: url, transport",
      } as PluginAPIHttpResponse);
    }

    // If tools provided, validate it's an array
    if (tools !== undefined && !Array.isArray(tools)) {
      return res.status(400).json({
        success: false,
        error: "tools must be an array if provided",
      } as PluginAPIHttpResponse);
    }

    try {
      const organizationId = pluginAuth.organizationId;
      const pluginId = pluginAuth.pluginId;
      const finalServerId = serverId || `mcp-remote-${Date.now()}`;

      console.log("========== MCP REGISTER REMOTE ==========");
      console.log("Organization ID:", organizationId);
      console.log("Plugin ID:", pluginId);
      console.log("Server ID:", finalServerId);
      console.log("URL:", url);
      console.log("Transport:", transport);
      console.log("Auth:", JSON.stringify(auth, null, 2));
      console.log("Tools count:", tools?.length || 0);
      console.log("Tools provided:", !!tools);

      debugLog("plugin-api", "Registering remote MCP server", {
        organizationId,
        pluginId,
        serverId: finalServerId,
        url,
        toolCount: tools?.length || 0,
        toolsProvided: !!tools,
      });

      // Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        return res.status(404).json({
          success: false,
          error: `Plugin instance not found for ${organizationId}:${pluginId}`,
        } as PluginAPIHttpResponse);
      }

      // Update config with MCP server definition
      const config = instance.config || {};
      if (!config.mcpServers) {
        config.mcpServers = { local: [], remote: [] };
      }

      const mcpServers = config.mcpServers as any;
      mcpServers.remote = mcpServers.remote || [];

      // Check for duplicate serverId
      if (mcpServers.remote.some((s: any) => s.serverId === finalServerId)) {
        return res.status(400).json({
          success: false,
          error: `MCP server with ID '${finalServerId}' already registered`,
        } as PluginAPIHttpResponse);
      }

      // Add MCP server config
      mcpServers.remote.push({
        serverId: finalServerId,
        url,
        transport,
        auth,
        tools,
      });

      // Save to database
      await pluginInstanceRepository.updateConfig(instance.id, config);
      console.log("✅ Config saved to database successfully");
      console.log("Final config:", JSON.stringify(config, null, 2));

      // Register tools in registry (only if tools provided)
      if (tools && tools.length > 0) {
        await mcpRegistryService.registerTools(organizationId, pluginId, finalServerId, tools);
        console.log("✅ Tools registered in registry");
      } else {
        console.log("ℹ️  No tools provided - will be discovered from MCP server");
      }

      debugLog("plugin-api", "Remote MCP server registered successfully", {
        organizationId,
        pluginId,
        serverId: finalServerId,
        toolsRegistered: tools?.length || 0,
      });

      return res.status(200).json({
        success: true,
        data: {
          serverId: finalServerId,
          toolsRegistered: tools?.length || 0,
        },
      } as PluginAPIHttpResponse);
    } catch (error) {
      debugLog("plugin-api", "Error registering remote MCP server", {
        level: "error",
        pluginId: pluginAuth.pluginId,
        organizationId: pluginAuth.organizationId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      } as PluginAPIHttpResponse);
    }
  },
);

export default router;
