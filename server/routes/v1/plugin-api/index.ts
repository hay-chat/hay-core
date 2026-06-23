import { Router, Request, Response, NextFunction } from "express";
import { PluginAPIService } from "../../../services/plugin-api/plugin-api.service";
import type {
  PluginAPITokenPayload,
  PluginAPIHttpResponse,
  SendEmailHttpRequest,
  SendEmailHttpResponse,
} from "../../../types/plugin-api.types";
import type {
  PluginInstanceConfig,
  LocalMCPServerConfig,
  RemoteMCPServerConfig,
} from "../../../types/plugin.types";
import { createLogger } from "@server/lib/logger";
import { mcpRegistryService } from "../../../services/mcp-registry.service";

const logger = createLogger("plugin-api");
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

const authenticatePlugin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
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
  logger.debug(
    { pluginId: payload.pluginId, organizationId: payload.organizationId },
    "Plugin API auth token validated",
  );
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
router.post("/send-email", authenticatePlugin, async (req: AuthenticatedRequest, res: Response) => {
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
    logger.debug(
      {
        pluginId: pluginAuth.pluginId,
        organizationId: pluginAuth.organizationId,
        subject: emailRequest.subject,
        hasTo: !!emailRequest.to,
        hasText: !!emailRequest.body,
        hasHtml: !!emailRequest.html,
      },
      "Received send-email request",
    );

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
    logger.error(
      {
        err: error,
        pluginId: pluginAuth.pluginId,
        organizationId: pluginAuth.organizationId,
      },
      "Error in send-email endpoint",
    );

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    } as PluginAPIHttpResponse);
  }
});

/**
 * GET /v1/plugin-api/health
 * Health check endpoint for plugins to verify API connectivity
 */
router.get("/health", authenticatePlugin, (req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      pluginId: req.pluginAuth!.pluginId,
      organizationId: req.pluginAuth!.organizationId,
      capabilities: req.pluginAuth!.capabilities,
    },
  } as PluginAPIHttpResponse);
});

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

    const { serverPath, startCommand, installCommand, buildCommand, tools, env, serverId } =
      req.body;

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

      logger.debug(
        {
          organizationId,
          pluginId,
          serverId: finalServerId,
          toolCount: tools?.length || 0,
          toolsProvided: !!tools,
        },
        "Registering local MCP server",
      );

      // Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        return res.status(404).json({
          success: false,
          error: `Plugin instance not found for ${organizationId}:${pluginId}`,
        } as PluginAPIHttpResponse);
      }

      // Update config with MCP server definition
      const config: PluginInstanceConfig = instance.config || {};
      if (!config.mcpServers) {
        config.mcpServers = { local: [], remote: [] };
      }

      const mcpServers = config.mcpServers;
      mcpServers.local = mcpServers.local || [];

      // Check for duplicate serverId
      if (mcpServers.local.some((s: LocalMCPServerConfig) => s.serverId === finalServerId)) {
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

      logger.info(
        {
          organizationId,
          pluginId,
          serverId: finalServerId,
          toolsRegistered: tools.length,
        },
        "Local MCP server registered successfully",
      );

      return res.status(200).json({
        success: true,
        data: {
          serverId: finalServerId,
          toolsRegistered: tools.length,
        },
      } as PluginAPIHttpResponse);
    } catch (error) {
      logger.error(
        {
          err: error,
          pluginId: pluginAuth.pluginId,
          organizationId: pluginAuth.organizationId,
        },
        "Error registering local MCP server",
      );

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

      logger.debug(
        {
          organizationId,
          pluginId,
          serverId: finalServerId,
          url,
          transport,
          hasAuth: !!auth,
          toolCount: tools?.length || 0,
          toolsProvided: !!tools,
        },
        "Registering remote MCP server",
      );

      // Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        return res.status(404).json({
          success: false,
          error: `Plugin instance not found for ${organizationId}:${pluginId}`,
        } as PluginAPIHttpResponse);
      }

      // Update config with MCP server definition
      const config: PluginInstanceConfig = instance.config || {};
      if (!config.mcpServers) {
        config.mcpServers = { local: [], remote: [] };
      }

      const mcpServers = config.mcpServers;
      mcpServers.remote = mcpServers.remote || [];

      // Check for duplicate serverId
      if (mcpServers.remote.some((s: RemoteMCPServerConfig) => s.serverId === finalServerId)) {
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
      logger.debug({ configKeys: Object.keys(config) }, "Config saved to database");

      // Register tools in registry (only if tools provided)
      if (tools && tools.length > 0) {
        await mcpRegistryService.registerTools(organizationId, pluginId, finalServerId, tools);
        logger.info({ toolCount: tools.length }, "Tools registered in registry");
      } else {
        logger.debug("No tools provided - will be discovered from MCP server");
      }

      logger.info(
        {
          organizationId,
          pluginId,
          serverId: finalServerId,
          toolsRegistered: tools?.length || 0,
        },
        "Remote MCP server registered successfully",
      );

      return res.status(200).json({
        success: true,
        data: {
          serverId: finalServerId,
          toolsRegistered: tools?.length || 0,
        },
      } as PluginAPIHttpResponse);
    } catch (error) {
      logger.error(
        {
          err: error,
          pluginId: pluginAuth.pluginId,
          organizationId: pluginAuth.organizationId,
        },
        "Error registering remote MCP server",
      );

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      } as PluginAPIHttpResponse);
    }
  },
);

export default router;
