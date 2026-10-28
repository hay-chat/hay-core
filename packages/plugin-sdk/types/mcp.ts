/**
 * Hay Plugin SDK - MCP (Model Context Protocol) Types
 *
 * Types for MCP server management in plugins.
 *
 * @module @hay/plugin-sdk/types/mcp
 */

import type { HayConfigRuntimeAPI } from "./config";
import type { HayAuthRuntimeAPI } from "./auth";
import type { HayLogger } from "./logger";

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
   * List all tools available from the MCP server.
   *
   * @returns Array of tool definitions
   *
   * @remarks
   * Called by the platform to discover available tools.
   * Required for local stdio MCP servers.
   */
  listTools?(): Promise<any[]>;

  /**
   * Call a tool on the MCP server.
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @returns Tool execution result
   *
   * @remarks
   * Called by the platform when a tool needs to be executed.
   * Required for local stdio MCP servers.
   */
  callTool?(name: string, args?: Record<string, any>): Promise<any>;

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
 * Write categories Hay.chat core understands (mirrors `@hay/plugin-sdk/tool-risk`).
 * Refunds, cancels, discounts and exchanges move money and are held for approval.
 * `destructive` (deletes, account configuration) is always held while approval is on.
 */
export type ToolWriteCategory =
  | "refund"
  | "cancel"
  | "discount"
  | "exchange"
  | "return"
  | "address_change"
  | "customer_update"
  | "note"
  | "destructive"
  | "other_write";

/**
 * A plugin's declaration of its tools' risk, for servers whose `tools/list`
 * the plugin cannot edit (hosted MCP servers, in-process servers).
 *
 * The worker merges it into each listed tool's `annotations` / `_meta`, where
 * core reads it. A declared tool takes the declaration (it overrides what the
 * server says). Any other tool keeps the server's own annotations, so a hosted
 * server's `readOnlyHint` still counts and an unknown write stays unclassified,
 * which core holds for approval.
 *
 * @example
 * ```typescript
 * toolRisk: {
 *   read: ["list_customers"],
 *   write: { create_refund: "refund", create_customer: "customer_update" },
 * }
 * ```
 */
export interface ToolRiskSpec {
  /** Tools that only read. */
  read?: string[];
  /** Tools that write, mapped to their category. */
  write?: Record<string, ToolWriteCategory>;
  /**
   * Write tools that enforce a merchant-set cap themselves (e.g. a goodwill
   * coupon). Calls within the cap skip the money approval hold; above it the
   * tool refuses with NEEDS_APPROVAL, core holds the call for a person and an
   * approved retry carries `hay_approval_id`. Each must also be in `write`.
   */
  capped?: string[];
}

/**
 * Options for `mcp.startLocal()`.
 */
export interface LocalMcpOptions {
  /** Risk class of the server's tools (see {@link ToolRiskSpec}). */
  toolRisk?: ToolRiskSpec;
}

/**
 * Stdio MCP server options.
 *
 * Configuration for spawning a local MCP server as a stdio-based child process.
 *
 * @remarks
 * Use this when you have an MCP server that communicates via stdin/stdout using
 * the JSON-RPC protocol. This is the most common pattern for local MCP servers.
 *
 * The SDK handles all process management, stdio communication, and lifecycle:
 * - Spawns the child process with the specified command/args
 * - Sets up JSON-RPC communication over stdin/stdout
 * - Manages graceful shutdown with SIGTERM/SIGKILL
 * - Resolves `cwd` relative to the plugin directory
 *
 * @example
 * ```typescript
 * await ctx.mcp.startLocalStdio({
 *   id: 'zendesk-mcp',
 *   command: 'node',
 *   args: ['index.js'],
 *   cwd: './mcp',
 *   env: {
 *     ZENDESK_SUBDOMAIN: subdomain,
 *     ZENDESK_EMAIL: email,
 *     ZENDESK_API_TOKEN: apiToken,
 *   },
 * });
 * ```
 *
 * @see PLUGIN.md Section 5.3.4 (lines 525-564)
 */
export interface StdioMcpOptions {
  /**
   * Unique identifier for this MCP server instance.
   *
   * @example "zendesk-mcp", "magento-mcp"
   */
  id: string;

  /**
   * Command to execute (e.g., 'node', 'python', 'deno')
   *
   * @example "node", "python3", "deno"
   */
  command: string;

  /**
   * Arguments to pass to the command
   *
   * @example ["index.js"], ["server.py"], ["run", "--allow-all", "server.ts"]
   */
  args: string[];

  /**
   * Working directory for the process (relative to plugin directory)
   *
   * @remarks
   * The SDK will resolve this path relative to the plugin's root directory.
   *
   * @example "./mcp", "./dist/mcp"
   */
  cwd: string;

  /**
   * Environment variables to pass to the process
   *
   * @remarks
   * These are merged with the current process.env.
   * Use this to pass credentials and configuration to the MCP server.
   *
   * @example { API_KEY: "secret", BASE_URL: "https://api.example.com" }
   */
  env?: Record<string, string>;

  /**
   * Request timeout in milliseconds (default: 30000)
   *
   * @remarks
   * How long to wait for MCP server responses before timing out.
   *
   * @default 30000
   */
  timeout?: number;

  /**
   * Risk class of the server's tools, when the server does not set it itself
   * (see {@link ToolRiskSpec}). A server can also set annotations directly
   * with `applyToolRisk` from `@hay/plugin-sdk/tool-risk`.
   */
  toolRisk?: ToolRiskSpec;
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

  /**
   * Risk class of the hosted server's tools (see {@link ToolRiskSpec}).
   * Overrides the server's own annotations for the tools it names.
   */
  toolRisk?: ToolRiskSpec;
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
   * @param options - Optional; `toolRisk` declares the risk class of its tools
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
    initializer: (ctx: McpInitializerContext) => Promise<McpServerInstance> | McpServerInstance,
    options?: LocalMcpOptions,
  ): Promise<void>;

  /**
   * Start a local stdio-based MCP server as a child process.
   *
   * This is the recommended way to start local MCP servers that communicate
   * via stdin/stdout. The SDK handles all process management and JSON-RPC
   * communication automatically.
   *
   * @param options - Stdio MCP server configuration
   * @returns Promise that resolves when server is started and initialized
   *
   * @throws If process fails to start or initialization fails
   *
   * @example
   * ```typescript
   * await ctx.mcp.startLocalStdio({
   *   id: 'zendesk-mcp',
   *   command: 'node',
   *   args: ['index.js'],
   *   cwd: './mcp',
   *   env: {
   *     ZENDESK_SUBDOMAIN: ctx.config.get('subdomain'),
   *     ZENDESK_API_TOKEN: ctx.config.get('apiToken'),
   *   },
   * });
   * ```
   *
   * @see {@link StdioMcpOptions}
   */
  startLocalStdio(options: StdioMcpOptions): Promise<void>;

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
