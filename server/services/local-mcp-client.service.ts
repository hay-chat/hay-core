import type { MCPClient, MCPTool, MCPCallResult } from "./mcp-client.interface";
import { processManagerService } from "./process-manager.service";
import { debugLog } from "@server/lib/debug-logger";
import { v4 as uuidv4 } from "uuid";

/**
 * Local MCP Client
 * Communicates with local MCP servers via stdio (existing implementation)
 */
export class LocalMCPClient implements MCPClient {
  private organizationId: string;
  private pluginId: string;

  constructor(organizationId: string, pluginId: string) {
    this.organizationId = organizationId;
    this.pluginId = pluginId;
  }

  /**
   * List available tools from the local MCP server
   */
  async listTools(): Promise<MCPTool[]> {
    // Ensure plugin is running
    if (!processManagerService.isRunning(this.organizationId, this.pluginId)) {
      await processManagerService.startPlugin(this.organizationId, this.pluginId);
    }

    const request = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/list",
      params: {},
    };

    try {
      const result = await processManagerService.sendToPlugin(
        this.organizationId,
        this.pluginId,
        "mcp_call",
        request,
      );

      const mcpResult = result as any;
      if (mcpResult.error) {
        throw new Error(`MCP error: ${mcpResult.error.message || mcpResult.error}`);
      }

      return (mcpResult.result?.tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema || {},
      }));
    } catch (error) {
      debugLog("local-mcp", `Failed to list tools`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Call a tool on the local MCP server
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    // Ensure plugin is running
    if (!processManagerService.isRunning(this.organizationId, this.pluginId)) {
      await processManagerService.startPlugin(this.organizationId, this.pluginId);
    }

    const request = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    };

    try {
      const result = await processManagerService.sendToPlugin(
        this.organizationId,
        this.pluginId,
        "mcp_call",
        request,
      );

      const mcpResult = result as any;
      if (mcpResult.error) {
        return {
          isError: true,
          error: mcpResult.error.message || String(mcpResult.error),
          content: mcpResult.error.data
            ? [{ type: "text", text: JSON.stringify(mcpResult.error.data) }]
            : [],
        };
      }

      // Transform MCP result to our format
      const toolResult = mcpResult.result || {};
      return {
        content: toolResult.content || [],
        isError: false,
        ...toolResult,
      };
    } catch (error) {
      debugLog("local-mcp", `Failed to call tool ${name}`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if the client is connected (plugin process is running)
   */
  isConnected(): boolean {
    return processManagerService.isRunning(this.organizationId, this.pluginId);
  }

  /**
   * Close/disconnect the client (stop plugin process)
   */
  async close(): Promise<void> {
    try {
      await processManagerService.stopPlugin(this.organizationId, this.pluginId);
    } catch (error) {
      debugLog("local-mcp", `Failed to stop plugin`, {
        level: "warn",
        data: error instanceof Error ? error.message : String(error),
      });
    }
  }
}


