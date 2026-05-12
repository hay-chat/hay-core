import type { MCPClient } from "./mcp-client.interface";
import { LocalHTTPMCPClient } from "./local-http-mcp-client.service";
import { RemoteMCPClient } from "./remote-mcp-client.service";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import type { HayPluginManifest } from "../types/plugin.types";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("mcp-factory");

/**
 * Factory for creating MCP clients based on plugin manifest configuration
 *
 * All local plugins use HTTP communication via the SDK runner.
 * Remote MCP servers are still supported via RemoteMCPClient.
 */
export class MCPClientFactory {
  /**
   * Create an MCP client for a plugin instance
   */
  static async createClient(organizationId: string, pluginId: string): Promise<MCPClient> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;

    // Check for remote MCP server configuration
    const connectionType = manifest.capabilities?.mcp?.connection?.type;

    if (connectionType === "remote") {
      const url = manifest.capabilities?.mcp?.connection?.url;
      if (!url) {
        throw new Error(`Remote MCP server URL not configured for plugin ${pluginId}`);
      }

      logger.debug({ url, organizationId }, `Creating remote MCP client for plugin ${pluginId}`);

      const client = new RemoteMCPClient(url, organizationId, pluginId);
      await client.connect();
      return client;
    }

    // All local plugins use HTTP-based communication via SDK runner
    logger.debug({ organizationId }, `Creating local HTTP MCP client for plugin ${pluginId}`);

    return new LocalHTTPMCPClient(organizationId, pluginId);
  }
}
