import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import type { MCPToolDefinition } from "../types/plugin.types";
import { getPluginRunnerV2Service } from "./plugin-runner-v2.service";

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
 * MCP Registry Service (SDK v2 Compatible)
 *
 * Central registry for managing MCP tools across all plugin instances.
 * For SDK v2 plugins, tools are fetched dynamically from worker /mcp/list-tools endpoint.
 * Handles tool discovery and routing to appropriate MCP servers via worker HTTP API.
 */
export class MCPRegistryService {
  private runnerService = getPluginRunnerV2Service();

  /**
   * Register tools from a plugin's MCP server (Legacy - deprecated for SDK v2)
   *
   * Note: SDK v2 plugins no longer use this method. Tools are discovered
   * dynamically via /mcp/list-tools endpoint.
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
   *
   * For SDK v2 plugins: Fetches tools from running workers via /mcp/list-tools endpoint
   * For legacy plugins: Reads from plugin_instances.config.mcpServers (fallback)
   */
  async getToolsForOrg(organizationId: string): Promise<MCPTool[]> {
    const instances = await pluginInstanceRepository.findByOrganization(organizationId);
    const tools: MCPTool[] = [];

    for (const instance of instances) {
      if (!instance.enabled) {
        continue;
      }

      // Get the semantic plugin ID (e.g., @hay/email-plugin) from the plugin registry
      // instance.pluginId is the UUID, instance.plugin.pluginId is the semantic ID
      const semanticPluginId = instance.plugin?.pluginId || instance.pluginId;

      // Check if worker is running (SDK v2)
      const worker = this.runnerService.getWorker(organizationId, instance.pluginId);

      if (worker && worker.sdkVersion === "v2" && instance.runtimeState === "ready") {
        // SDK v2: Fetch tools from worker /mcp/list-tools endpoint
        try {
          const response = await fetch(`http://localhost:${worker.port}/mcp/list-tools`, {
            signal: AbortSignal.timeout(5000)
          });

          if (response.ok) {
            const data = await response.json() as { tools: any[] };

            for (const tool of data.tools || []) {
              tools.push({
                id: `${semanticPluginId}:${tool.serverId || 'default'}:${tool.name}`,
                organizationId,
                pluginId: semanticPluginId, // Use semantic plugin ID (e.g., @hay/email-plugin)
                serverId: tool.serverId || 'default',
                name: tool.name,
                description: tool.description,
                input_schema: tool.input_schema,
                createdAt: instance.updatedAt || instance.createdAt,
              });
            }

            console.log(`[MCPRegistry] Fetched ${data.tools?.length || 0} tools from ${semanticPluginId} worker`);
          } else {
            console.warn(`[MCPRegistry] Failed to fetch tools from ${semanticPluginId}: HTTP ${response.status}`);
          }
        } catch (error: any) {
          console.warn(`[MCPRegistry] Failed to fetch tools from ${semanticPluginId}:`, error.message);
        }
      } else if (instance.config?.mcpServers) {
        // Legacy: Read from config
        const mcpServers = instance.config.mcpServers as any;
        const { local = [], remote = [] } = mcpServers;

        // Collect tools from local MCP servers
        for (const server of local) {
          for (const tool of server.tools) {
            tools.push({
              id: `${semanticPluginId}:${server.serverId}:${tool.name}`,
              organizationId: organizationId,
              pluginId: semanticPluginId, // Use semantic plugin ID (e.g., @hay/email-plugin)
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
              id: `${semanticPluginId}:${server.serverId}:${tool.name}`,
              organizationId: organizationId,
              pluginId: semanticPluginId, // Use semantic plugin ID (e.g., @hay/email-plugin)
              serverId: server.serverId,
              name: tool.name,
              description: tool.description,
              input_schema: tool.input_schema,
              createdAt: instance.updatedAt || instance.createdAt,
            });
          }
        }

        console.log(`[MCPRegistry] Loaded ${local.length + remote.length} servers from ${semanticPluginId} config (legacy)`);
      }
    }

    console.log(`[MCPRegistry] Found ${tools.length} total tools for organization ${organizationId}`);
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
   * Execute a tool (SDK v2 Compatible)
   *
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
      throw new Error(
        `Plugin worker not running for ${tool.pluginId} (org: ${organizationId})`
      );
    }

    if (worker.sdkVersion === "v2") {
      // SDK v2: Route to worker /mcp/call-tool endpoint
      console.log(`[MCPRegistry] Executing tool ${toolName} via worker ${tool.pluginId} on port ${worker.port}`);

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
        console.log(`[MCPRegistry] Tool ${toolName} executed successfully`);
        return result;
      } catch (error: any) {
        console.error(`[MCPRegistry] Tool execution failed for ${toolName}:`, error.message);
        throw new Error(`Tool execution failed: ${error.message}`);
      }
    } else {
      // Legacy: Not yet implemented
      console.log(`[MCPRegistry] Legacy tool execution for ${toolName} not yet implemented`);
      throw new Error("Tool execution not yet implemented for legacy plugins");
    }
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
