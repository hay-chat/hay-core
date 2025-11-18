import { v4 as uuidv4 } from "uuid";
import { processManagerService } from "../process-manager.service";
import { debugLog } from "@server/lib/debug-logger";
import type { MCPClient, MCPRequest, MCPToolResult } from "./mcp-client.interface";

/**
 * Local MCP Client
 * Communicates with local MCP servers via stdio (child process)
 */
export class LocalMCPClient implements MCPClient {
  private organizationId: string;
  private pluginId: string;
  private ready: boolean = false;

  constructor(organizationId: string, pluginId: string) {
    this.organizationId = organizationId;
    this.pluginId = pluginId;
  }

  /**
   * Initialize by ensuring the plugin process is running
   */
  async initialize(): Promise<void> {
    try {
      debugLog("mcp-local", `Initializing local MCP client for plugin: ${this.pluginId}`);

      // The plugin instance manager will ensure the process is running
      // This is handled automatically when calling tools via processManagerService
      this.ready = true;

      debugLog("mcp-local", `Local MCP client initialized successfully`);
    } catch (error) {
      debugLog("mcp-local", `Failed to initialize local MCP client`, {
        level: "error",
        data: error,
      });
      throw error;
    }
  }

  /**
   * Call a tool via the local MCP server process
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.ready) {
      await this.initialize();
    }

    const request: MCPRequest = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    };

    debugLog("mcp-local", `Calling tool: ${toolName}`, { data: args });

    // Use existing processManagerService to send request via stdio
    const response = await processManagerService.sendToPlugin(
      this.organizationId,
      this.pluginId,
      "mcp_call",
      request,
    );

    if (response && typeof response === "object") {
      const mcpResponse = response as any;

      if (mcpResponse.error) {
        throw new Error(`MCP tool error: ${mcpResponse.error.message || mcpResponse.error}`);
      }

      return mcpResponse.result as MCPToolResult;
    }

    throw new Error("Invalid response from MCP server");
  }

  /**
   * List available tools from the local MCP server
   */
  async listTools(): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }>
  > {
    if (!this.ready) {
      await this.initialize();
    }

    const request: MCPRequest = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/list",
      params: {},
    };

    debugLog("mcp-local", `Listing tools for plugin: ${this.pluginId}`);

    const response = await processManagerService.sendToPlugin(
      this.organizationId,
      this.pluginId,
      "mcp_call",
      request,
    );

    if (response && typeof response === "object") {
      const mcpResponse = response as any;

      if (mcpResponse.error) {
        throw new Error(`MCP error: ${mcpResponse.error.message || mcpResponse.error}`);
      }

      if (mcpResponse.result && typeof mcpResponse.result === "object") {
        const result = mcpResponse.result as { tools?: unknown[] };
        if (Array.isArray(result.tools)) {
          return result.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          }));
        }
      }
    }

    return [];
  }

  /**
   * Check if client is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Disconnect by stopping the plugin process
   */
  async disconnect(): Promise<void> {
    this.ready = false;
    // Note: We don't automatically stop the process here
    // The plugin instance manager handles process lifecycle
    debugLog("mcp-local", `Local MCP client disconnected for plugin: ${this.pluginId}`);
  }
}
