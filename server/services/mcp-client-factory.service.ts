import type { MCPClient } from "./mcp-client.interface";
import { LocalMCPClient } from "./local-mcp-client.service";
import { LocalHTTPMCPClient } from "./local-http-mcp-client.service";
import { RemoteMCPClient } from "./remote-mcp-client.service";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import type { HayPluginManifest } from "../types/plugin.types";
import { debugLog } from "@server/lib/debug-logger";

/**
 * Factory for creating MCP clients based on plugin manifest configuration
 */
export class MCPClientFactory {
  /**
   * Create an MCP client for a plugin instance
   */
  static async createClient(
    organizationId: string,
    pluginId: string,
  ): Promise<MCPClient> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;

    // Check if SDK v2 plugin (uses HTTP communication)
    const isSDKv2 = Array.isArray(manifest.capabilities) && manifest.capabilities.includes("mcp");

    if (isSDKv2) {
      debugLog("mcp-factory", `Creating local HTTP MCP client for SDK v2 plugin ${pluginId}`, {
        organizationId,
      });

      return new LocalHTTPMCPClient(organizationId, pluginId);
    }

    // Legacy plugins
    const connectionType = manifest.capabilities?.mcp?.connection?.type || "local";

    if (connectionType === "remote") {
      const url = manifest.capabilities?.mcp?.connection?.url;
      if (!url) {
        throw new Error(`Remote MCP server URL not configured for plugin ${pluginId}`);
      }

      debugLog("mcp-factory", `Creating remote MCP client for plugin ${pluginId}`, {
        url,
        organizationId,
      });

      const client = new RemoteMCPClient(url, organizationId, pluginId);
      await client.connect();
      return client;
    } else {
      debugLog("mcp-factory", `Creating local stdio MCP client for plugin ${pluginId}`, {
        organizationId,
      });

      return new LocalMCPClient(organizationId, pluginId);
    }
  }
}


