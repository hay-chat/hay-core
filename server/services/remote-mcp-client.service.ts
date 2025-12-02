import type { MCPClient, MCPTool, MCPCallResult } from "./mcp-client.interface";
import { oauthAuthStrategy } from "./oauth-auth-strategy.service";
import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { decryptConfig } from "../lib/auth/utils/encryption";
import { debugLog } from "@server/lib/debug-logger";
import { v4 as uuidv4 } from "uuid";

/**
 * Remote MCP Client
 * Communicates with remote MCP servers over HTTP/HTTPS with SSE support
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
   * Send JSON-RPC request and parse SSE response
   * Used for MCP servers that use Server-Sent Events (SSE) transport
   */
  private async sendSSERequest(
    request: any,
    authHeaders: Record<string, string>
  ): Promise<any> {
    // Try without forcing text/event-stream first - let server decide
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...authHeaders,
    };

    console.log('🔄 Sending SSE request:', request.method);
    console.log('🔄 Request headers:', { ...headers, Authorization: headers.Authorization?.substring(0, 30) + '...' });

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    console.log('📡 SSE response status:', response.status, response.statusText);
    console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.log('❌ SSE error response:', errorText);
      throw new Error(`SSE request failed: ${response.status} ${response.statusText}`);
    }

    // Check if response is SSE
    const contentType = response.headers.get('content-type');
    console.log('📡 Content-Type:', contentType);

    if (!contentType?.includes('text/event-stream')) {
      // Not SSE, try to parse as regular JSON
      console.log('⚠️  Not an SSE response, parsing as JSON');
      const result = await response.json();
      return result;
    }

    // Parse SSE stream
    console.log('📡 Parsing SSE stream...');
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let jsonResponse: any = null;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('📡 SSE stream ended');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        console.log('📡 Buffer chunk received:', buffer.substring(0, 100) + '...');

        // Process complete SSE messages (separated by double newlines)
        const messages = buffer.split('\n\n');
        buffer = messages.pop() || ''; // Keep incomplete message in buffer

        for (const message of messages) {
          if (!message.trim()) continue;

          console.log('📡 Processing SSE message:', message.substring(0, 200));

          // Parse SSE format: "data: {...}"
          const lines = message.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonData = line.substring(6); // Remove "data: " prefix
              try {
                const parsed = JSON.parse(jsonData);
                console.log('✅ Parsed SSE JSON:', JSON.stringify(parsed, null, 2));

                // Store the JSON-RPC response
                if (parsed.jsonrpc && parsed.id === request.id) {
                  jsonResponse = parsed;
                }
              } catch (e) {
                console.log('⚠️  Failed to parse SSE data line:', jsonData);
              }
            }
          }
        }

        // If we got a response matching our request ID, we can stop
        if (jsonResponse) {
          console.log('✅ Got matching JSON-RPC response, closing stream');
          reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!jsonResponse) {
      throw new Error('No JSON-RPC response received from SSE stream');
    }

    return jsonResponse;
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
   * Initialize connection to remote MCP server (using SSE transport)
   */
  async connect(): Promise<void> {
    try {
      console.log('\n========== REMOTE MCP CONNECT START (SSE) ==========');
      console.log('Plugin ID:', this.pluginId);
      console.log('MCP Server URL:', this.baseUrl);

      // Get auth headers (OAuth or API key)
      const authHeaders = await this.getAuthHeaders();
      console.log('Auth headers obtained:', Object.keys(authHeaders));

      // Log headers (without full token)
      const logHeaders = { ...authHeaders };
      if (logHeaders.Authorization) {
        const parts = logHeaders.Authorization.split(' ');
        if (parts.length === 2) {
          logHeaders.Authorization = `${parts[0]} ${parts[1].substring(0, 20)}...`;
        }
      }
      console.log('Request headers (masked):', logHeaders);

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

      console.log('Sending initialize request via SSE...');

      // Use SSE transport
      const result = await this.sendSSERequest(initRequest, authHeaders);

      console.log('MCP server response:', JSON.stringify(result, null, 2));

      if (result.error) {
        console.log('❌ MCP returned error:', result.error);
        throw new Error(`MCP initialization error: ${result.error.message || result.error}`);
      }

      this.connected = true;
      console.log('✅ Successfully connected to MCP server via SSE');
      console.log('========== REMOTE MCP CONNECT SUCCESS ==========\n');
      debugLog("remote-mcp", `Connected to remote MCP server: ${this.baseUrl}`);
    } catch (error) {
      console.log('❌ Failed to connect to MCP server');
      console.log('Error:', error);
      console.log('========== REMOTE MCP CONNECT FAILED ==========\n');
      debugLog("remote-mcp", `Failed to connect to remote MCP server`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List available tools from the remote MCP server (using SSE transport)
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.connected) {
      await this.connect();
    }

    // Get auth headers (OAuth or API key)
    const authHeaders = await this.getAuthHeaders();

    const request = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/list",
      params: {},
    };

    try {
      console.log('📋 Listing tools via SSE...');

      // Use SSE transport
      const result = await this.sendSSERequest(request, authHeaders);

      if (result.error) {
        throw new Error(`MCP error: ${result.error.message || result.error}`);
      }

      const tools = (result.result?.tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema || {},
      }));

      console.log(`✅ Retrieved ${tools.length} tools from MCP server`);
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
   * Call a tool on the remote MCP server (using SSE transport)
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    if (!this.connected) {
      await this.connect();
    }

    // Get auth headers (OAuth or API key)
    const authHeaders = await this.getAuthHeaders();

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
      console.log(`🔧 Calling tool "${name}" via SSE...`);

      // Use SSE transport
      const result = await this.sendSSERequest(request, authHeaders);

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
      console.log(`✅ Tool "${name}" executed successfully`);

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


