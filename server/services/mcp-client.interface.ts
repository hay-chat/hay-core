/**
 * MCP Client Interface
 * Abstraction for both local (stdio) and remote (HTTP) MCP servers
 */

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPCallResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Base interface for MCP clients
 */
export interface MCPClient {
  /**
   * List available tools from the MCP server
   */
  listTools(): Promise<MCPTool[]>;

  /**
   * Call a tool on the MCP server. `meta` is core-owned context for the call
   * (the verified customer, see core/customer-identity); clients for servers
   * Hay.chat runs itself pass it as the MCP request's `_meta`, kept apart from
   * the model-written args. Clients for third-party servers do not send it.
   */
  callTool(
    name: string,
    args: Record<string, unknown>,
    meta?: Record<string, unknown>,
  ): Promise<MCPCallResult>;

  /**
   * Check if the client is connected/ready
   */
  isConnected(): boolean;

  /**
   * Close/disconnect the client
   */
  close(): Promise<void>;
}
