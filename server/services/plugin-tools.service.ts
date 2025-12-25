/**
 * Plugin Tools Service
 *
 * Handles discovery and storage of MCP tools from plugin workers.
 * Tools are fetched from worker's /mcp/list-tools endpoint and cached
 * in the database for fast retrieval and offline access.
 */

import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";

/**
 * MCP Tool definition from worker
 */
interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  serverId?: string;
}

/**
 * MCP Server configuration with tools
 */
interface LocalMCPServerConfig {
  serverId: string;
  serverPath?: string;
  startCommand?: string;
  tools?: MCPTool[];
}

/**
 * Fetch tools from a running plugin worker
 *
 * @param port - Worker HTTP port
 * @param pluginId - Plugin identifier for logging
 * @returns Array of tools with serverId
 */
export async function fetchToolsFromWorker(
  port: number,
  pluginId: string
): Promise<MCPTool[]> {
  const maxRetries = 3;
  const timeoutMs = 5000;
  let lastError: Error | null = null;

  console.log(`[Tools] ===== fetchToolsFromWorker called =====`);
  console.log(`[Tools] Plugin: ${pluginId}, Port: ${port}`);
  console.log(`[Tools] Max retries: ${maxRetries}, Timeout: ${timeoutMs}ms`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Create AbortController for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const url = `http://localhost:${port}/mcp/list-tools`;
      console.log(
        `[Tools] 📡 Attempt ${attempt}/${maxRetries}: Fetching ${url}`
      );

      const response = await fetch(url, {
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      console.log(`[Tools] Response status: ${response.status} ${response.statusText}`);
      console.log(`[Tools] Response headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorBody = await response.text();
        console.log(`[Tools] Error response body:`, errorBody);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[Tools] Response data:`, JSON.stringify(data, null, 2));

      // Worker returns { tools: [...] }
      const tools = Array.isArray(data.tools) ? data.tools : [];

      console.log(`[Tools] ✅ Successfully fetched ${tools.length} tools for ${pluginId}`);
      if (tools.length > 0) {
        console.log(`[Tools] Tool names:`, tools.map((t: MCPTool) => t.name));
      } else {
        console.log(`[Tools] ⚠️  No tools in response (empty array)`);
      }

      return tools;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error as Error;

      if (error instanceof Error && error.name === "AbortError") {
        console.warn(
          `[Tools] ⏱️  Timeout for ${pluginId} (attempt ${attempt}/${maxRetries})`
        );
      } else {
        console.warn(
          `[Tools] ❌ Fetch failed for ${pluginId} (attempt ${attempt}/${maxRetries}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        if (error instanceof Error && error.stack) {
          console.warn(`[Tools] Error stack:`, error.stack);
        }
      }

      // Exponential backoff between retries
      if (attempt < maxRetries) {
        const backoffMs = 1000 * attempt;
        console.log(`[Tools] ⏳ Waiting ${backoffMs}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // All retries failed
  const errorMsg = `Failed to fetch tools after ${maxRetries} attempts: ${
    lastError?.message || "Unknown error"
  }`;
  console.error(`[Tools] ❌❌❌ ${errorMsg}`);
  throw new Error(errorMsg);
}

/**
 * Store tools in plugin instance config
 *
 * @param instanceId - Plugin instance ID
 * @param tools - Tools to store (with serverId)
 */
export async function storeToolsInConfig(
  instanceId: string,
  tools: MCPTool[]
): Promise<void> {
  // Get current instance
  const instance = await pluginInstanceRepository.findById(instanceId);
  if (!instance) {
    throw new Error(`Plugin instance ${instanceId} not found`);
  }

  // Get current config or initialize
  const config = (instance.config as any) || {};

  // Initialize mcpServers structure if missing
  if (!config.mcpServers) {
    config.mcpServers = { local: [], remote: [] };
  }
  if (!config.mcpServers.local) {
    config.mcpServers.local = [];
  }

  // Group tools by serverId
  const toolsByServer = new Map<string, MCPTool[]>();
  for (const tool of tools) {
    const serverId = tool.serverId || "default";
    if (!toolsByServer.has(serverId)) {
      toolsByServer.set(serverId, []);
    }
    toolsByServer.get(serverId)!.push(tool);
  }

  // Update or create server entries
  for (const [serverId, serverTools] of toolsByServer.entries()) {
    // Find existing server entry
    const existingServerIndex = config.mcpServers.local.findIndex(
      (s: LocalMCPServerConfig) => s.serverId === serverId
    );

    // Remove serverId from tools before storing (it's redundant)
    const cleanTools = serverTools.map(({ serverId: _, ...tool }) => tool);

    if (existingServerIndex >= 0) {
      // Update existing server
      config.mcpServers.local[existingServerIndex].tools = cleanTools;
    } else {
      // Create new server entry
      config.mcpServers.local.push({
        serverId,
        tools: cleanTools,
      });
    }
  }

  // Persist updated config
  await pluginInstanceRepository.updateConfig(instanceId, config);

  console.log(
    `[Tools] Stored ${tools.length} tools for instance ${instanceId} across ${toolsByServer.size} server(s)`
  );
}

/**
 * Fetch and store tools from a running plugin worker
 *
 * Main entry point - fetches tools from worker and stores in database.
 * Non-blocking - errors are logged but not thrown.
 *
 * @param port - Worker HTTP port
 * @param orgId - Organization ID
 * @param pluginId - Plugin identifier
 */
export async function fetchAndStoreTools(
  port: number,
  orgId: string,
  pluginId: string
): Promise<void> {
  try {
    console.log(`[Tools] Starting tool discovery for ${pluginId}:${orgId}`);

    // Fetch tools from worker
    const tools = await fetchToolsFromWorker(port, pluginId);

    if (tools.length === 0) {
      console.log(`[Tools] No tools found for ${pluginId}:${orgId}`);
      return;
    }

    // Get plugin instance
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      orgId,
      pluginId
    );

    if (!instance) {
      throw new Error(`Plugin instance not found for ${pluginId}:${orgId}`);
    }

    // Store tools in config
    await storeToolsInConfig(instance.id, tools);

    console.log(
      `[Tools] Successfully stored ${tools.length} tools for ${pluginId}:${orgId}`
    );
  } catch (error) {
    console.error(
      `[Tools] Failed to fetch and store tools for ${pluginId}:${orgId}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Don't throw - this is non-blocking
  }
}
