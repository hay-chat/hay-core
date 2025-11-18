import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { createAuthStrategy } from "../auth/auth-strategy-factory";
import { LocalMCPClient } from "./local-mcp-client";
import { RemoteMCPClient } from "./remote-mcp-client";
import type { MCPClient } from "./mcp-client.interface";
import type { HayPluginManifest } from "@server/types/plugin.types";
import { debugLog } from "@server/lib/debug-logger";

/**
 * MCP Client Factory
 * Creates the appropriate MCP client (local or remote) based on plugin configuration
 */
export class MCPClientFactory {
  /**
   * Create an MCP client for a plugin instance
   */
  async createClient(organizationId: string, pluginId: string): Promise<MCPClient> {
    // Get plugin instance and manifest
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      organizationId,
      pluginId,
    );

    if (!instance) {
      throw new Error(`Plugin instance not found for org ${organizationId}`);
    }

    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;

    // Determine connection type from manifest
    const connectionType = manifest.capabilities?.mcp?.connection?.type || "local";

    debugLog("mcp-factory", `Creating ${connectionType} MCP client for plugin: ${pluginId}`, {
      data: { organizationId },
    });

    if (connectionType === "remote") {
      // Create remote MCP client
      const url = manifest.capabilities?.mcp?.connection?.url;
      if (!url) {
        throw new Error(`Remote MCP URL not configured for plugin: ${pluginId}`);
      }

      // Create auth strategy
      const authStrategy = createAuthStrategy(instance, manifest);

      // Create remote client with auth headers provider
      const client = new RemoteMCPClient(url, async () => {
        return await authStrategy.getHeaders();
      });

      return client;
    } else {
      // Create local MCP client
      const client = new LocalMCPClient(organizationId, pluginId);
      return client;
    }
  }

  /**
   * Get auth headers for a plugin (for manual tool calls)
   */
  async getAuthHeaders(organizationId: string, pluginId: string): Promise<Record<string, string>> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      organizationId,
      pluginId,
    );

    if (!instance) {
      return {};
    }

    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      return {};
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const authStrategy = createAuthStrategy(instance, manifest);

    return await authStrategy.getHeaders();
  }

  /**
   * Get auth environment variables for a plugin (for local processes)
   */
  async getAuthEnvironment(organizationId: string, pluginId: string): Promise<Record<string, string>> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      organizationId,
      pluginId,
    );

    if (!instance) {
      return {};
    }

    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      return {};
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const authStrategy = createAuthStrategy(instance, manifest);

    return await authStrategy.getEnvironmentVariables();
  }
}

export const mcpClientFactory = new MCPClientFactory();
