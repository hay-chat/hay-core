/**
 * MCP Client Interface
 * Abstraction for communicating with MCP servers (local or remote)
 */

export interface MCPClient {
  /**
   * Call an MCP tool
   * @param toolName - Name of the tool to call
   * @param args - Tool arguments
   * @returns Tool execution result
   */
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;

  /**
   * List available tools from the MCP server
   * @returns List of available tools
   */
  listTools(): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }>
  >;

  /**
   * Initialize the MCP client connection
   */
  initialize(): Promise<void>;

  /**
   * Check if the client is ready/connected
   */
  isReady(): boolean;

  /**
   * Disconnect/cleanup the client
   */
  disconnect(): Promise<void>;
}

/**
 * MCP JSON-RPC Request
 */
export interface MCPRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
}

/**
 * MCP JSON-RPC Response
 */
export interface MCPResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * MCP Tool Call Result
 */
export interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
  isError?: boolean;
}
