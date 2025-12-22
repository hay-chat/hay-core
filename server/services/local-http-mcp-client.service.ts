import type { MCPClient, MCPTool, MCPCallResult } from "./mcp-client.interface";
import { getPluginRunnerV2Service } from "./plugin-runner-v2.service";
import { debugLog } from "@server/lib/debug-logger";

/**
 * Local HTTP MCP Client
 * Communicates with local SDK v2 plugin workers via HTTP
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
    const runnerV2 = getPluginRunnerV2Service();

    // Check if worker is running
    if (!runnerV2.isRunning(this.organizationId, this.pluginId)) {
      debugLog("local-http-mcp", `Starting SDK v2 worker for ${this.pluginId}`);
      await runnerV2.startWorker(this.organizationId, this.pluginId);
    }

    // Get worker info
    const worker = runnerV2.getWorker(this.organizationId, this.pluginId);
    if (!worker) {
      throw new Error(`Failed to get worker info for ${this.pluginId}`);
    }

    return `http://localhost:${worker.port}`;
  }

  /**
   * List available tools from the SDK v2 worker
   */
  async listTools(): Promise<MCPTool[]> {
    const baseUrl = await this.ensureWorkerRunning();

    debugLog("local-http-mcp", `Fetching tools from ${this.pluginId}`, {
      url: `${baseUrl}/mcp/list-tools`,
    });

    try {
      const response = await fetch(`${baseUrl}/mcp/list-tools`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { tools: any[] };
      const tools: MCPTool[] = (data.tools || []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema || tool.inputSchema || {},
      }));

      debugLog("local-http-mcp", `Fetched ${tools.length} tools from ${this.pluginId}`);
      return tools;
    } catch (error) {
      debugLog("local-http-mcp", `Failed to list tools from ${this.pluginId}`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Call a tool on the SDK v2 worker
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const baseUrl = await this.ensureWorkerRunning();

    debugLog("local-http-mcp", `Calling tool ${toolName} on ${this.pluginId}`, {
      url: `${baseUrl}/mcp/call-tool`,
      args,
    });

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
        debugLog("local-http-mcp", `Tool call failed with HTTP ${response.status}`, {
          level: "error",
          data: errorText,
        });
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      debugLog("local-http-mcp", `Tool call ${toolName} completed`, {
        isError: result.isError || false,
      });

      return {
        content: result.content || result,
        isError: result.isError || false,
        error: result.error,
      };
    } catch (error) {
      debugLog("local-http-mcp", `Failed to call tool ${toolName}`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
      });

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
    const runnerV2 = getPluginRunnerV2Service();
    return runnerV2.isRunning(this.organizationId, this.pluginId);
  }

  /**
   * Close/disconnect (stop the worker)
   */
  async close(): Promise<void> {
    const runnerV2 = getPluginRunnerV2Service();
    if (runnerV2.isRunning(this.organizationId, this.pluginId)) {
      await runnerV2.stopWorker(this.organizationId, this.pluginId);
    }
  }
}
