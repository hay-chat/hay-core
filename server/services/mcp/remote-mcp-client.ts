import { v4 as uuidv4 } from "uuid";
import { debugLog } from "@server/lib/debug-logger";
import type { MCPClient, MCPRequest, MCPResponse, MCPToolResult } from "./mcp-client.interface";

/**
 * Remote MCP Client
 * Connects to remote MCP servers via HTTP/HTTPS
 */
export class RemoteMCPClient implements MCPClient {
  private serverUrl: string;
  private authHeaders: () => Promise<Record<string, string>>;
  private ready: boolean = false;
  private tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];

  constructor(serverUrl: string, authHeaders: () => Promise<Record<string, string>>) {
    this.serverUrl = serverUrl;
    this.authHeaders = authHeaders;
  }

  /**
   * Initialize connection and list tools
   */
  async initialize(): Promise<void> {
    try {
      debugLog("mcp-remote", `Initializing remote MCP client: ${this.serverUrl}`);

      // Send initialize request
      const initRequest: MCPRequest = {
        jsonrpc: "2.0",
        id: uuidv4(),
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "hay-core",
            version: "1.0.0",
          },
        },
      };

      const initResponse = await this.sendRequest(initRequest);
      debugLog("mcp-remote", `Initialize response:`, { data: initResponse });

      // List available tools
      await this.refreshTools();

      this.ready = true;
      debugLog("mcp-remote", `Remote MCP client initialized successfully`);
    } catch (error) {
      debugLog("mcp-remote", `Failed to initialize remote MCP client`, {
        level: "error",
        data: error,
      });
      throw new Error(
        `Failed to initialize remote MCP client: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refresh the list of available tools
   */
  private async refreshTools(): Promise<void> {
    const toolsRequest: MCPRequest = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/list",
      params: {},
    };

    const toolsResponse = await this.sendRequest(toolsRequest);

    if (toolsResponse.result && typeof toolsResponse.result === "object") {
      const result = toolsResponse.result as { tools?: unknown[] };
      if (Array.isArray(result.tools)) {
        this.tools = result.tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
        debugLog("mcp-remote", `Loaded ${this.tools.length} tools from remote MCP server`);
      }
    }
  }

  /**
   * Call a tool on the remote MCP server
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

    debugLog("mcp-remote", `Calling tool: ${toolName}`, { data: args });

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`MCP tool error: ${response.error.message}`);
    }

    return response.result as MCPToolResult;
  }

  /**
   * List available tools
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

    return this.tools;
  }

  /**
   * Check if client is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Disconnect (no-op for HTTP clients)
   */
  async disconnect(): Promise<void> {
    this.ready = false;
    this.tools = [];
    debugLog("mcp-remote", `Remote MCP client disconnected`);
  }

  /**
   * Send HTTP request to remote MCP server
   */
  private async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    try {
      const headers = await this.authHeaders();

      const response = await fetch(this.serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Validate JSON-RPC response
      if (!data || typeof data !== "object") {
        throw new Error("Invalid JSON-RPC response");
      }

      if (data.jsonrpc !== "2.0") {
        throw new Error("Invalid JSON-RPC version");
      }

      if (data.id !== request.id) {
        throw new Error("JSON-RPC response ID mismatch");
      }

      return data as MCPResponse;
    } catch (error) {
      debugLog("mcp-remote", `HTTP request failed`, { level: "error", data: error });
      throw new Error(
        `Failed to send request to remote MCP server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
