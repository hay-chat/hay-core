/**
 * Hay Plugin SDK v2 - MCP (Model Context Protocol) Types
 *
 * Types for MCP server management in plugins.
 *
 * @module @hay/plugin-sdk-v2/types/mcp
 */

import type { HayConfigRuntimeAPI } from './config';
import type { HayAuthRuntimeAPI } from './auth';
import type { HayLogger } from './logger';

/**
 * MCP server instance.
 *
 * Represents a running MCP server instance (local or external).
 *
 * @remarks
 * Plugin-defined MCP servers should implement this interface.
 * The `stop()` method is optional but recommended for cleanup.
 *
 * The platform is responsible for:
 * - Tracking running MCP instances
 * - Stopping them on worker shutdown
 * - Restarting them when config changes
 *
 * @example
 * ```typescript
 * class ShopifyOrdersMcpServer implements McpServerInstance {
 *   private client: ShopifyClient;
 *   private logger: HayLogger;
 *
 *   constructor(opts: { apiKey: string; logger: HayLogger }) {
 *     this.client = new ShopifyClient(opts.apiKey);
 *     this.logger = opts.logger;
 *   }
 *
 *   async stop() {
 *     await this.client.disconnect();
 *     this.logger.info('Shopify MCP server stopped');
 *   }
 * }
 * ```
 *
 * @see PLUGIN.md Section 5.3.4 (lines 525-564)
 * @see PLUGIN.md Section 8 (lines 701-750)
 */
export interface McpServerInstance {
  /**
   * Stop the MCP server and clean up resources.
   *
   * @remarks
   * Called automatically by the platform during:
   * - Worker shutdown
   * - Plugin disable
   * - Config updates (before restart)
   *
   * Optional but recommended for proper cleanup.
   */
  stop?(): Promise<void> | void;
}

/**
 * MCP initializer context.
 *
 * Context provided to local MCP server initializer function.
 * Gives access to org config, auth, and logger.
 *
 * @remarks
 * This is a subset of `HayStartContext` containing only what's needed
 * for MCP server initialization.
 */
export interface McpInitializerContext {
  /**
   * Config runtime API for reading org config values.
   */
  config: HayConfigRuntimeAPI;

  /**
   * Auth runtime API for reading auth credentials.
   */
  auth: HayAuthRuntimeAPI;

  /**
   * Logger for MCP server logs.
   */
  logger: HayLogger;
}

/**
 * External MCP server options.
 *
 * Configuration for connecting to an external (remote) MCP server.
 *
 * @remarks
 * Use this when the MCP server is hosted elsewhere (e.g., a cloud service).
 * The platform will connect to the external server using the provided URL.
 *
 * @example
 * ```typescript
 * await ctx.mcp.startExternal({
 *   id: 'shopify-mcp-proxy',
 *   url: 'https://mcp.shopify-proxy.com',
 *   authHeaders: {
 *     Authorization: `Bearer ${ctx.config.get('apiKey')}`,
 *   },
 * });
 * ```
 *
 * @see PLUGIN.md Section 5.3.4 (lines 525-564)
 */
export interface ExternalMcpOptions {
  /**
   * Unique identifier for this MCP server instance.
   *
   * @example "stripe-mcp-proxy", "external-knowledge-base"
   */
  id: string;

  /**
   * Base URL of the external MCP server.
   *
   * @example "https://mcp.myservice.com"
   */
  url: string;

  /**
   * Optional auth headers for external MCP server.
   *
   * @remarks
   * Headers are typically derived from config/auth.
   *
   * @example { Authorization: "Bearer token123" }
   */
  authHeaders?: Record<string, string>;
}

/**
 * MCP runtime API.
 *
 * Used in org runtime hooks to start local or external MCP servers.
 *
 * @remarks
 * MCP servers are org-specific - each organization gets its own MCP instance(s).
 * The platform manages server lifecycle:
 * - Starts servers when `onStart` calls `mcp.startLocal/startExternal`
 * - Stops servers on worker shutdown or plugin disable
 * - Restarts servers when config changes
 *
 * **Constraint**: Only available in org runtime contexts (onStart, etc.).
 * NOT available in `onInitialize`.
 *
 * @see PLUGIN.md Section 5.3.4 (lines 525-564)
 * @see PLUGIN.md Section 8 (lines 701-750)
 */
export interface HayMcpRuntimeAPI {
  /**
   * Start a local MCP server for this organization.
   *
   * The initializer function receives a context with config, auth, and logger.
   * It should return an `McpServerInstance` (sync or async).
   *
   * @param id - Unique identifier for this MCP server instance
   * @param initializer - Function that creates and returns the MCP server instance
   * @returns Promise that resolves when server is started
   *
   * @throws If initializer fails or MCP server fails to start
   *
   * @example
   * ```typescript
   * await ctx.mcp.startLocal('shopify-orders', (mcpCtx) => {
   *   const apiKey = mcpCtx.config.get<string>('apiKey');
   *   return new ShopifyOrdersMcpServer({ apiKey, logger: mcpCtx.logger });
   * });
   * ```
   *
   * @see {@link McpServerInstance}
   * @see {@link McpInitializerContext}
   */
  startLocal(
    id: string,
    initializer: (
      ctx: McpInitializerContext,
    ) => Promise<McpServerInstance> | McpServerInstance,
  ): Promise<void>;

  /**
   * Connect to an external MCP server.
   *
   * Use this when the MCP server is hosted remotely.
   *
   * @param options - External MCP server configuration
   * @returns Promise that resolves when connection is established
   *
   * @throws If connection fails
   *
   * @example
   * ```typescript
   * await ctx.mcp.startExternal({
   *   id: 'knowledge-base',
   *   url: 'https://kb-mcp.example.com',
   *   authHeaders: {
   *     'X-API-Key': ctx.config.get('kbApiKey'),
   *   },
   * });
   * ```
   *
   * @see {@link ExternalMcpOptions}
   */
  startExternal(options: ExternalMcpOptions): Promise<void>;
}
