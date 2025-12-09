import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import type { MCPToolDefinition } from "../types/plugin.types";

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
 * Handles tool registration, discovery, and routing to appropriate MCP servers.
 */
export class MCPRegistryService {
  /**
   * Register tools from a plugin's MCP server
   */
  async registerTools(
    organizationId: string,
    pluginId: string,
    serverId: string,
    tools: MCPToolDefinition[],
  ): Promise<void> {
    console.log(
      `[MCPRegistry] Registering ${tools.length} tools for ${organizationId}:${pluginId}:${serverId}`,
    );

    // Tools are stored in plugin_instances.config.mcpServers
    // No separate registration needed - they're already stored by the registration endpoint
    // This method exists for future expansion (e.g., caching, indexing)

    console.log(`[MCPRegistry] Registered tools: ${tools.map((t) => t.name).join(", ")}`);
  }

  /**
   * Get all tools available for an organization
   */
  async getToolsForOrg(organizationId: string): Promise<MCPTool[]> {
    const instances = await pluginInstanceRepository.findByOrganization(organizationId);
    const tools: MCPTool[] = [];

    for (const instance of instances) {
      if (!instance.enabled || !instance.config?.mcpServers) {
        continue;
      }

      const mcpServers = instance.config.mcpServers as any;
      const { local = [], remote = [] } = mcpServers;

      // Collect tools from local MCP servers
      for (const server of local) {
        for (const tool of server.tools) {
          tools.push({
            id: `${instance.pluginId}:${server.serverId}:${tool.name}`,
            organizationId: organizationId,
            pluginId: instance.pluginId,
            serverId: server.serverId,
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
            createdAt: instance.updatedAt || instance.createdAt,
          });
        }
      }

      // Collect tools from remote MCP servers
      for (const server of remote) {
        for (const tool of server.tools) {
          tools.push({
            id: `${instance.pluginId}:${server.serverId}:${tool.name}`,
            organizationId: organizationId,
            pluginId: instance.pluginId,
            serverId: server.serverId,
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
            createdAt: instance.updatedAt || instance.createdAt,
          });
        }
      }
    }

    console.log(`[MCPRegistry] Found ${tools.length} tools for organization ${organizationId}`);
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
   *
   * Routes the tool call to the appropriate MCP server via the plugin manager.
   * This is a placeholder - actual execution happens through the plugin worker/MCP client.
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

    // TODO: Route to plugin manager to execute tool via MCP client
    // For now, this is a placeholder that will be implemented when
    // agent system integration is added

    console.log(`[MCPRegistry] Executing tool ${toolName} for ${organizationId} with args:`, args);

    throw new Error("Tool execution not yet implemented - requires MCP client integration");
  }

  /**
   * Unregister tools (when plugin disabled or MCP server removed)
   */
  async unregisterTools(
    organizationId: string,
    pluginId: string,
    serverId?: string,
  ): Promise<void> {
    console.log(
      `[MCPRegistry] Unregistering tools for ${organizationId}:${pluginId}${serverId ? `:${serverId}` : ""}`,
    );

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);

    if (!instance || !instance.config?.mcpServers) {
      return;
    }

    if (serverId) {
      // Remove specific MCP server
      const config = instance.config;
      const mcpServers = config.mcpServers as any;
      if (mcpServers.local) {
        mcpServers.local = mcpServers.local.filter((s: any) => s.serverId !== serverId);
      }
      if (mcpServers.remote) {
        mcpServers.remote = mcpServers.remote.filter((s: any) => s.serverId !== serverId);
      }

      await pluginInstanceRepository.updateConfig(instance.id, config);
    } else {
      // Remove all MCP servers for this plugin
      const config = instance.config;
      delete config.mcpServers;

      await pluginInstanceRepository.updateConfig(instance.id, config);
    }

    console.log(`[MCPRegistry] Unregistered tools successfully`);
  }
}

// Export singleton instance
export const mcpRegistryService = new MCPRegistryService();
