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
   * Call a tool on the MCP server
   */
  callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult>;

  /**
   * Check if the client is connected/ready
   */
  isConnected(): boolean;

  /**
   * Close/disconnect the client
   */
  close(): Promise<void>;
}


