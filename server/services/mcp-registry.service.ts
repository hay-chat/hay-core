import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import type { MCPToolDefinition } from "../types/plugin.types";
import { getPluginRunnerService } from "./plugin-runner.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("mcp-registry");

/**
 * MCP Tool with metadata
 */
export interface MCPTool extends MCPToolDefinition {
  id: string;
  organizationId: string;
  pluginId: string;
  serverId: string;
  createdAt: Date;
}

/**
 * MCP Registry Service
 *
 * Central registry for managing MCP tools across all plugin instances.
 * Tools are fetched dynamically from worker /mcp/list-tools endpoint.
 * Handles tool discovery and routing to appropriate MCP servers via worker HTTP API.
 */
export class MCPRegistryService {
  private runnerService = getPluginRunnerService();

  /**
   * Register tools from a plugin's MCP server
   * Note: Tools are discovered dynamically via /mcp/list-tools endpoint,
   * so this method is primarily for logging/tracking purposes.
   */
  async registerTools(
    organizationId: string,
    pluginId: string,
    serverId: string,
    tools: MCPToolDefinition[],
  ): Promise<void> {
    logger.debug(
      {
        organizationId,
        pluginId,
        serverId,
        toolCount: tools.length,
        toolNames: tools.map((t) => t.name),
      },
      "Registering tools",
    );
  }

  /**
   * Get all tools available for an organization
   * Fetches tools from running workers via /mcp/list-tools endpoint
   */
  async getToolsForOrg(organizationId: string): Promise<MCPTool[]> {
    const instances = await pluginInstanceRepository.findByOrganization(organizationId);
    const tools: MCPTool[] = [];

    for (const instance of instances) {
      if (!instance.enabled) {
        continue;
      }

      // Get the semantic plugin ID (e.g., hay-plugin-email) from the plugin registry
      // instance.pluginId is the UUID, instance.plugin.pluginId is the semantic ID
      const semanticPluginId = instance.plugin?.pluginId || instance.pluginId;

      // Check if worker is running
      const worker = this.runnerService.getWorker(organizationId, instance.pluginId);

      if (worker && instance.runtimeState === "ready") {
        // Fetch tools from worker /mcp/list-tools endpoint
        try {
          const response = await fetch(`http://localhost:${worker.port}/mcp/list-tools`, {
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            const data = (await response.json()) as { tools: any[] };

            for (const tool of data.tools || []) {
              tools.push({
                id: `${semanticPluginId}:${tool.serverId || "default"}:${tool.name}`,
                organizationId,
                pluginId: semanticPluginId,
                serverId: tool.serverId || "default",
                name: tool.name,
                description: tool.description,
                input_schema: tool.input_schema,
                createdAt: instance.updatedAt || instance.createdAt,
              });
            }

            logger.debug(
              { pluginId: semanticPluginId, toolCount: data.tools?.length || 0 },
              "Fetched tools from worker",
            );
          } else {
            logger.warn(
              { pluginId: semanticPluginId, status: response.status },
              "Failed to fetch tools from worker",
            );
          }
        } catch (error: any) {
          logger.warn(
            { pluginId: semanticPluginId, error: error.message },
            "Failed to fetch tools from worker",
          );
        }
      }
    }

    logger.debug({ organizationId, toolCount: tools.length }, "Found total tools for organization");
    return tools;
  }

  /**
   * Get specific tool definition
   */
  async getTool(organizationId: string, toolName: string): Promise<MCPTool | null> {
    const tools = await this.getToolsForOrg(organizationId);
    return tools.find((t) => t.name === toolName) || null;
  }

  /**
   * Execute a tool
   * Routes the tool call to the appropriate plugin worker via /mcp/call-tool endpoint.
   */
  async executeTool(
    organizationId: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<any> {
    const tool = await this.getTool(organizationId, toolName);

    if (!tool) {
      throw new Error(`Tool ${toolName} not found for organization ${organizationId}`);
    }

    // Get worker for this plugin
    const worker = this.runnerService.getWorker(organizationId, tool.pluginId);

    if (!worker) {
      throw new Error(`Plugin worker not running for ${tool.pluginId} (org: ${organizationId})`);
    }

    logger.debug(
      { toolName, pluginId: tool.pluginId, port: worker.port },
      "Executing tool via worker",
    );

    try {
      const response = await fetch(`http://localhost:${worker.port}/mcp/call-tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName,
          arguments: args,
        }),
        signal: AbortSignal.timeout(30000), // 30 second timeout for tool execution
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`MCP tool call failed: HTTP ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      logger.debug({ toolName }, "Tool executed successfully");
      return result;
    } catch (error: any) {
      logger.error({ toolName, error: error.message }, "Tool execution failed");
      throw new Error(`Tool execution failed: ${error.message}`);
    }
  }
}

// Export singleton instance
export const mcpRegistryService = new MCPRegistryService();
