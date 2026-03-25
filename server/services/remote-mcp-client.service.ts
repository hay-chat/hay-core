import type { MCPClient, MCPTool, MCPCallResult } from "./mcp-client.interface";
import { oauthAuthStrategy } from "./oauth-auth-strategy.service";
import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { decryptConfig } from "../lib/auth/utils/encryption";
import { createLogger } from "@server/lib/logger";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("remote-mcp");

/**
 * Validate that a URL does not point to private/internal networks (SSRF protection).
 * Rejects private IP ranges, localhost, link-local, cloud metadata endpoints,
 * and non-HTTP(S) schemes.
 */
function validatePublicUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid MCP server URL: ${url}`);
  }

  // Only allow HTTP(S) schemes
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Invalid URL scheme "${parsed.protocol}" — only http: and https: are allowed`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  ) {
    throw new Error("MCP server URL must not point to localhost");
  }

  // Block cloud metadata endpoints
  if (hostname === "metadata.google.internal" || hostname === "169.254.169.254") {
    throw new Error("MCP server URL must not point to cloud metadata endpoints");
  }

  // Block private/reserved IPv4 ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      a === 127 || // 127.0.0.0/8
      (a === 169 && b === 254) || // 169.254.0.0/16 (link-local)
      a === 0 // 0.0.0.0/8
    ) {
      throw new Error("MCP server URL must not point to a private or reserved IP range");
    }
  }

  // Block IPv6 private ranges (fc00::/7 = fc and fd prefixes, fe80::/10 = link-local)
  if (hostname.startsWith("[")) {
    const ipv6 = hostname.slice(1, -1).toLowerCase();
    if (
      ipv6.startsWith("fc") ||
      ipv6.startsWith("fd") ||
      ipv6.startsWith("fe80") ||
      ipv6 === "::1"
    ) {
      throw new Error("MCP server URL must not point to a private or link-local IPv6 address");
    }
  }
}

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
    validatePublicUrl(baseUrl);
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.organizationId = organizationId;
    this.pluginId = pluginId;
  }

  /**
   * Send JSON-RPC request and parse SSE response
   * Used for MCP servers that use Server-Sent Events (SSE) transport
   */
  private async sendSSERequest(request: any, authHeaders: Record<string, string>): Promise<any> {
    // Try without forcing text/event-stream first - let server decide
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...authHeaders,
    };

    logger.debug({ method: request.method }, "Sending SSE request");
    logger.debug({ hasAuthHeader: !!headers.Authorization }, "Request headers prepared");

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    logger.debug(
      { status: response.status, statusText: response.statusText },
      "SSE response received",
    );
    logger.debug({ headers: Object.fromEntries(response.headers.entries()) }, "Response headers");

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, errorText }, "SSE error response");
      throw new Error(`SSE request failed: ${response.status} ${response.statusText}`);
    }

    // Check if response is SSE
    const contentType = response.headers.get("content-type");
    logger.debug({ contentType }, "Response content type");

    if (!contentType?.includes("text/event-stream")) {
      // Not SSE, try to parse as regular JSON
      logger.debug("Not an SSE response, parsing as JSON");
      const result = await response.json();
      return result;
    }

    // Parse SSE stream
    logger.debug("Parsing SSE stream");
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body reader available");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let jsonResponse: any = null;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          logger.debug("SSE stream ended");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        logger.debug({ bufferLength: buffer.length }, "Buffer chunk received");

        // Process complete SSE messages (separated by double newlines)
        const messages = buffer.split("\n\n");
        buffer = messages.pop() || ""; // Keep incomplete message in buffer

        for (const message of messages) {
          if (!message.trim()) continue;

          logger.debug({ messageLength: message.length }, "Processing SSE message");

          // Parse SSE format: "data: {...}"
          const lines = message.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const jsonData = line.substring(6); // Remove "data: " prefix
              try {
                const parsed = JSON.parse(jsonData);
                logger.debug({ parsedId: parsed.id }, "Parsed SSE JSON response");

                // Store the JSON-RPC response
                if (parsed.jsonrpc && parsed.id === request.id) {
                  jsonResponse = parsed;
                }
              } catch (e) {
                logger.warn({ dataLength: jsonData.length }, "Failed to parse SSE data line");
              }
            }
          }
        }

        // If we got a response matching our request ID, we can stop
        if (jsonResponse) {
          logger.debug("Got matching JSON-RPC response, closing stream");
          reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!jsonResponse) {
      throw new Error("No JSON-RPC response received from SSE stream");
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
      const oauthHeaders = await oauthAuthStrategy.getHeaders(this.organizationId, this.pluginId);
      Object.assign(headers, oauthHeaders);
      logger.info({ pluginId: this.pluginId }, "Using OAuth authentication");
      return headers;
    } catch (error) {
      // OAuth not available, try API key fallback
      logger.debug({ pluginId: this.pluginId }, "OAuth not available, trying API key");
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
          logger.info({ pluginId: this.pluginId }, "Using API key authentication");
          return headers;
        }
      }
    } catch (error) {
      logger.warn(
        { pluginId: this.pluginId, err: error instanceof Error ? error : new Error(String(error)) },
        "Failed to get API key",
      );
    }

    // No authentication available
    logger.warn({ pluginId: this.pluginId }, "No authentication available");
    return headers;
  }

  /**
   * Initialize connection to remote MCP server (using SSE transport)
   */
  async connect(): Promise<void> {
    try {
      logger.info(
        { pluginId: this.pluginId, url: this.baseUrl },
        "Connecting to remote MCP server via SSE",
      );

      // Get auth headers (OAuth or API key)
      const authHeaders = await this.getAuthHeaders();
      logger.debug(
        { hasAuthHeader: !!authHeaders.Authorization, headerKeys: Object.keys(authHeaders) },
        "Auth headers obtained",
      );

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

      logger.debug("Sending initialize request via SSE");

      // Use SSE transport
      const result = await this.sendSSERequest(initRequest, authHeaders);

      logger.debug({ hasError: !!result.error }, "MCP server initialize response received");

      if (result.error) {
        logger.error({ error: result.error }, "MCP initialization returned error");
        throw new Error(`MCP initialization error: ${result.error.message || result.error}`);
      }

      this.connected = true;
      logger.info({ url: this.baseUrl }, "Successfully connected to remote MCP server via SSE");
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          pluginId: this.pluginId,
          url: this.baseUrl,
        },
        "Failed to connect to remote MCP server",
      );
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
      logger.debug("Listing tools via SSE");

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

      logger.info({ toolCount: tools.length }, "Retrieved tools from MCP server");
      return tools;
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        "Failed to list tools",
      );
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
      logger.debug({ toolName: name }, "Calling tool via SSE");

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
      logger.info({ toolName: name }, "Tool executed successfully");

      return {
        content: toolResult.content || [],
        isError: false,
        ...toolResult,
      };
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error : new Error(String(error)), toolName: name },
        "Failed to call tool",
      );
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
