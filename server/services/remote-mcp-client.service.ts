import type { MCPClient, MCPTool, MCPCallResult } from "./mcp-client.interface";
import { oauthAuthStrategy } from "./oauth-auth-strategy.service";
import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { decryptConfig } from "../lib/auth/utils/encryption";
import { debugLog } from "@server/lib/debug-logger";
import { v4 as uuidv4 } from "uuid";

/**
 * Remote MCP Client
 * Communicates with remote MCP servers over HTTP/HTTPS
 * Supports both OAuth and API key authentication
 */
export class RemoteMCPClient implements MCPClient {
  private baseUrl: string;
  private organizationId: string;
  private pluginId: string;
  private connected: boolean = false;

  constructor(baseUrl: string, organizationId: string, pluginId: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.organizationId = organizationId;
    this.pluginId = pluginId;
  }

  /**
   * Get authentication headers (OAuth or API key)
   * Priority: OAuth > API Key > No Auth
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    // Try OAuth first
    try {
      const oauthHeaders = await oauthAuthStrategy.getHeaders(
        this.organizationId,
        this.pluginId,
      );
      Object.assign(headers, oauthHeaders);
      debugLog("remote-mcp", `Using OAuth authentication for plugin ${this.pluginId}`);
      return headers;
    } catch (error) {
      // OAuth not available, try API key fallback
      debugLog("remote-mcp", `OAuth not available for plugin ${this.pluginId}, trying API key`, {
        level: "debug",
      });
    }

    // Try API key fallback
    try {
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(
        this.organizationId,
        this.pluginId,
      );

      if (instance?.config) {
        const decryptedConfig = decryptConfig(instance.config);

        // Check for various API key field names (plugin-specific)
        const apiKey =
          (decryptedConfig as any).stripeApiKey ||
          (decryptedConfig as any).apiKey ||
          (decryptedConfig as any).api_key;

        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`;
          debugLog("remote-mcp", `Using API key authentication for plugin ${this.pluginId}`);
          return headers;
        }
      }
    } catch (error) {
      debugLog("remote-mcp", `Failed to get API key for plugin ${this.pluginId}`, {
        level: "warn",
        data: error instanceof Error ? error.message : String(error),
      });
    }

    // No authentication available
    debugLog("remote-mcp", `No authentication available for plugin ${this.pluginId}`, {
      level: "warn",
    });
    return headers;
  }

  /**
   * Initialize connection to remote MCP server
   */
  async connect(): Promise<void> {
    try {
      // Get auth headers (OAuth or API key)
      const authHeaders = await this.getAuthHeaders();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...authHeaders,
      };

      // Test connection with initialize request
      const initRequest = {
        jsonrpc: "2.0",
        id: uuidv4(),
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "hay",
            version: "1.0.0",
          },
        },
      };

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(initRequest),
      });

      if (!response.ok) {
        throw new Error(`MCP initialization failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(`MCP initialization error: ${result.error.message || result.error}`);
      }

      this.connected = true;
      debugLog("remote-mcp", `Connected to remote MCP server: ${this.baseUrl}`);
    } catch (error) {
      debugLog("remote-mcp", `Failed to connect to remote MCP server`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List available tools from the remote MCP server
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.connected) {
      await this.connect();
    }

    // Get auth headers (OAuth or API key)
    const authHeaders = await this.getAuthHeaders();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...authHeaders,
    };

    const request = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/list",
      params: {},
    };

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog("remote-mcp", `Failed to list tools: ${response.status} ${response.statusText}`, {
          level: "error",
          data: { body: errorText }
        });
        throw new Error(`Failed to list tools: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(`MCP error: ${result.error.message || result.error}`);
      }

      const tools = (result.result?.tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema || {},
      }));

      return tools;
    } catch (error) {
      debugLog("remote-mcp", `Failed to list tools`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Call a tool on the remote MCP server
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    if (!this.connected) {
      await this.connect();
    }

    // Get auth headers (OAuth or API key)
    const authHeaders = await this.getAuthHeaders();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...authHeaders,
    };

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
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog("remote-mcp", `Tool call failed: ${response.status} ${response.statusText}`, {
          level: "error",
          data: { tool: name, body: errorText }
        });
        throw new Error(`Tool call failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        return {
          isError: true,
          error: result.error.message || String(result.error),
          content: result.error.data
            ? [{ type: "text", text: JSON.stringify(result.error.data) }]
            : [],
        };
      }

      // Transform MCP result to our format
      const toolResult = result.result || {};
      return {
        content: toolResult.content || [],
        isError: false,
        ...toolResult,
      };
    } catch (error) {
      debugLog("remote-mcp", `Failed to call tool ${name}`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Close/disconnect the client
   */
  async close(): Promise<void> {
    this.connected = false;
  }
}


