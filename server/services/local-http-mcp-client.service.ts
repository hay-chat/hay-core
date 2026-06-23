import type { MCPClient, MCPTool, MCPCallResult } from "./mcp-client.interface";
import { getPluginRunnerService } from "./plugin-runner.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("local-http-mcp");

/** Raw tool descriptor returned by the SDK worker's /mcp/list-tools endpoint. */
interface RawWorkerTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
}

/**
 * Local HTTP MCP Client
 * Communicates with local SDK plugin workers via HTTP
 */
export class LocalHTTPMCPClient implements MCPClient {
  private organizationId: string;
  private pluginId: string;
  private baseUrl: string | null = null;

  constructor(organizationId: string, pluginId: string) {
    this.organizationId = organizationId;
    this.pluginId = pluginId;
  }

  /**
   * Ensure worker is running and get base URL
   */
  private async ensureWorkerRunning(): Promise<string> {
    const runner = getPluginRunnerService();

    // Check if worker is running
    if (!runner.isRunning(this.organizationId, this.pluginId)) {
      logger.debug(`Starting SDK worker for ${this.pluginId}`);
      await runner.startWorker(this.organizationId, this.pluginId);
    }

    // Get worker info
    const worker = runner.getWorker(this.organizationId, this.pluginId);
    if (!worker) {
      throw new Error(`Failed to get worker info for ${this.pluginId}`);
    }

    return `http://localhost:${worker.port}`;
  }

  /**
   * List available tools from the SDK worker
   */
  async listTools(): Promise<MCPTool[]> {
    const baseUrl = await this.ensureWorkerRunning();

    logger.debug({ url: `${baseUrl}/mcp/list-tools` }, `Fetching tools from ${this.pluginId}`);

    try {
      const response = await fetch(`${baseUrl}/mcp/list-tools`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as { tools?: RawWorkerTool[] };
      const tools: MCPTool[] = (data.tools || []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema || tool.inputSchema || {},
      }));

      logger.debug(`Fetched ${tools.length} tools from ${this.pluginId}`);
      return tools;
    } catch (error) {
      logger.error({ err: error }, `Failed to list tools from ${this.pluginId}`);
      throw error;
    }
  }

  /**
   * Call a tool on the SDK worker
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const baseUrl = await this.ensureWorkerRunning();

    logger.debug(
      { url: `${baseUrl}/mcp/call-tool`, args },
      `Calling tool ${toolName} on ${this.pluginId}`,
    );

    try {
      const response = await fetch(`${baseUrl}/mcp/call-tool`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toolName,
          arguments: args,
        }),
        signal: AbortSignal.timeout(60000), // 60 second timeout for tool execution
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ errorText }, `Tool call failed with HTTP ${response.status}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      logger.debug({ isError: result.isError || false }, `Tool call ${toolName} completed`);

      return {
        content: result.content || result,
        isError: result.isError || false,
        error: result.error,
      };
    } catch (error) {
      logger.error({ err: error }, `Failed to call tool ${toolName}`);

      return {
        content: undefined,
        isError: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if worker is connected/ready
   */
  isConnected(): boolean {
    const runner = getPluginRunnerService();
    return runner.isRunning(this.organizationId, this.pluginId);
  }

  /**
   * Close/disconnect (stop the worker)
   */
  async close(): Promise<void> {
    const runner = getPluginRunnerService();
    if (runner.isRunning(this.organizationId, this.pluginId)) {
      await runner.stopWorker(this.organizationId, this.pluginId);
    }
  }
}
