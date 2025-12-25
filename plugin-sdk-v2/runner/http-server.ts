/**
 * Hay Plugin SDK v2 - HTTP Server
 *
 * Internal HTTP server for plugin workers with /metadata endpoint
 * and plugin-registered routes.
 *
 * @module @hay/plugin-sdk-v2/runner/http-server
 */

import express, { type Express, type Request, type Response } from 'express';
import type { Server } from 'http';
import type { HayLogger, HayMcpRuntimeAPI } from '../types/index.js';
import { PluginRegistry } from '../sdk/registry.js';
import type { HayPluginDefinition } from '../types/plugin.js';
import {
  executeOnValidateAuth,
  executeOnConfigUpdate,
  executeOnDisable,
} from './hook-executor.js';
import { createConfigRuntimeAPI } from '../sdk/config-runtime.js';
import { createAuthRuntimeAPI } from '../sdk/auth-runtime.js';

/**
 * Plugin HTTP server instance.
 *
 * Wraps Express server with plugin-specific functionality.
 */
// Track registered MCP servers
interface RegisteredMcpServer {
  id: string;
  type: 'local' | 'external';
  instance?: any; // McpServerInstance for local servers
  options?: any; // ExternalMcpOptions for external servers
}

export class PluginHttpServer {
  private app: Express;
  private server: Server | null = null;
  private port: number;
  private logger: HayLogger;
  private registry: PluginRegistry;
  private plugin: HayPluginDefinition | null = null;
  private orgId: string | null = null;
  private manifest: any | null = null; // Plugin manifest for runtime API creation
  private orgConfig: Record<string, any> | null = null;

  // Track MCP servers registered via mcp.startLocal() or mcp.startExternal()
  private mcpServers: Map<string, RegisteredMcpServer> = new Map();

  constructor(port: number, registry: PluginRegistry, logger: HayLogger) {
    this.port = port;
    this.logger = logger;
    this.registry = registry;
    this.app = express();

    // Middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Setup routes
    this.setupHealthEndpoint();
    this.setupMetadataEndpoint();
    this.setupLifecycleEndpoints();
    this.setupMcpEndpoints();
    this.setupPluginRoutes();
    this.setupErrorHandler();
  }

  /**
   * Set the plugin definition (needed for hook execution).
   *
   * @param plugin - Plugin definition
   */
  setPlugin(plugin: HayPluginDefinition): void {
    this.plugin = plugin;
  }

  /**
   * Set runtime data (needed for context creation in endpoints).
   *
   * @param data - Runtime data
   */
  setRuntimeData(data: {
    orgId: string;
    manifest: any;
    mcpRuntime: HayMcpRuntimeAPI;
    orgConfig: Record<string, any>;
    orgAuth: any;
  }): void {
    this.orgId = data.orgId;
    this.manifest = data.manifest;
    this.orgConfig = data.orgConfig;
    // Note: orgAuth and mcpRuntime are passed but not stored -
    // MCP servers are tracked via registerMcpServer() callback instead
  }

  /**
   * Register an MCP server (called by MCP runtime when plugin calls mcp.startLocal/startExternal)
   *
   * @param server - MCP server metadata
   * @internal
   */
  registerMcpServer(server: RegisteredMcpServer): void {
    this.mcpServers.set(server.id, server);
    this.logger.debug(`Registered MCP server: ${server.id} (${server.type})`);
  }

  /**
   * Setup the /health endpoint.
   *
   * Lightweight healthcheck endpoint for monitoring worker status.
   * Returns basic worker health information including uptime, MCP server count, etc.
   *
   * This is the standard endpoint for:
   * - Docker HEALTHCHECK directives
   * - Kubernetes readiness/liveness probes
   * - Monitoring systems (Prometheus, Datadog, etc.)
   */
  private setupHealthEndpoint(): void {
    this.app.get('/health', (_req: Request, res: Response) => {
      try {
        const health = {
          status: 'healthy',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          pid: process.pid,
          orgId: this.orgId,
          mcpServers: {
            count: this.mcpServers.size,
            servers: Array.from(this.mcpServers.keys()),
          },
          memory: {
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
            heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024), // MB
          },
        };

        res.status(200).json(health);
        this.logger.debug('Served /health endpoint', { orgId: this.orgId });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error('Error serving /health endpoint', { error: errorMsg });
        res.status(503).json({
          status: 'unhealthy',
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  /**
   * Setup the /metadata endpoint.
   *
   * This endpoint returns:
   * - Config schema
   * - Auth methods registry
   * - UI extensions
   * - Route metadata
   * - MCP descriptors (placeholder for now)
   *
   * @see PLUGIN.md Section 3.2 (lines 116-132)
   */
  private setupMetadataEndpoint(): void {
    this.app.get('/metadata', (_req: Request, res: Response) => {
      try {
        const configSchema = this.registry.getConfigSchema();
        const authMethods = this.registry.getAuthMethods();
        const uiExtensions = this.registry.getUIExtensions();
        const routes = this.registry.getRoutes();

        // Build metadata response
        const metadata = {
          configSchema,
          authMethods: authMethods.map((method) => {
            // Transform auth methods to metadata format
            if ('configField' in method) {
              // API Key auth
              return {
                type: 'apiKey',
                id: method.id,
                label: method.label,
                configField: method.configField,
              };
            } else {
              // OAuth2 auth
              return {
                type: 'oauth2',
                id: method.id,
                label: method.label,
                authorizationUrl: method.authorizationUrl,
                tokenUrl: method.tokenUrl,
                scopes: method.scopes || [],
                clientId: method.clientId.name,
                clientSecret: method.clientSecret.name,
              };
            }
          }),
          uiExtensions,
          routes: routes.map((route) => ({
            method: route.method,
            path: route.path,
          })),
          mcp: {
            local: [], // Populated dynamically when MCPs start
            external: [], // Populated dynamically when MCPs start
          },
        };

        res.json(metadata);
        this.logger.debug('Served /metadata endpoint');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error('Error serving /metadata endpoint', { error: errorMsg });
        res.status(500).json({ error: 'Failed to generate metadata' });
      }
    });
  }

  /**
   * Setup lifecycle hook endpoints.
   *
   * These endpoints allow Hay Core to trigger plugin hooks:
   * - POST /validate-auth - Validate auth credentials
   * - POST /config-update - Notify config change
   * - POST /disable - Cleanup before shutdown
   *
   * @see PLUGIN_SDK_V2_MIGRATION_PLAN.md Section 0
   */
  private setupLifecycleEndpoints(): void {
    // POST /validate-auth
    this.app.post('/validate-auth', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.plugin) {
          res.status(500).json({
            valid: false,
            error: 'Plugin not initialized'
          });
          return;
        }

        if (!this.orgId || !this.manifest || this.orgConfig === null) {
          res.status(400).json({
            valid: false,
            error: 'Runtime data not set'
          });
          return;
        }

        const { authState } = req.body;

        if (!authState || !authState.methodId || !authState.credentials) {
          res.status(400).json({
            valid: false,
            error: 'Invalid auth state format'
          });
          return;
        }

        // Create runtime APIs for validation context
        const configAPI = createConfigRuntimeAPI({
          orgConfig: this.orgConfig,
          registry: this.registry,
          manifest: { env: this.manifest.env },
          logger: this.logger,
        });

        const authAPI = createAuthRuntimeAPI({
          authState,
          logger: this.logger,
        });

        // Build auth validation context
        const authCtx = {
          org: { id: this.orgId },
          config: configAPI,
          auth: authAPI,
          logger: this.logger,
        };

        // Execute validation hook
        const isValid = await executeOnValidateAuth(
          this.plugin,
          authCtx as any,
          this.logger
        );

        res.json({ valid: isValid });
        this.logger.debug('Handled /validate-auth', { valid: isValid });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error('Error in /validate-auth endpoint', { error: errorMsg });
        res.status(500).json({
          valid: false,
          error: errorMsg
        });
      }
    });

    // POST /config-update
    this.app.post('/config-update', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.plugin) {
          res.status(500).json({
            success: false,
            error: 'Plugin not initialized'
          });
          return;
        }

        if (!this.orgId || !this.manifest || this.orgConfig === null) {
          res.status(400).json({
            success: false,
            error: 'Runtime data not set'
          });
          return;
        }

        const { config } = req.body;

        if (!config) {
          res.status(400).json({
            success: false,
            error: 'Config object required'
          });
          return;
        }

        // Create config runtime API with updated config
        const configAPI = createConfigRuntimeAPI({
          orgConfig: config,
          registry: this.registry,
          manifest: { env: this.manifest.env },
          logger: this.logger,
        });

        // Build config update context
        const configCtx = {
          org: { id: this.orgId },
          config: configAPI,
          logger: this.logger,
        };

        // Execute config update hook
        await executeOnConfigUpdate(
          this.plugin,
          configCtx as any,
          this.logger
        );

        res.json({ success: true });
        this.logger.debug('Handled /config-update');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error('Error in /config-update endpoint', { error: errorMsg });
        res.status(500).json({
          success: false,
          error: errorMsg
        });
      }
    });

    // POST /disable
    this.app.post('/disable', async (_req: Request, res: Response): Promise<void> => {
      try {
        if (!this.plugin) {
          res.status(500).json({
            success: false,
            error: 'Plugin not initialized'
          });
          return;
        }

        if (!this.orgId) {
          res.status(400).json({
            success: false,
            error: 'Organization ID not set'
          });
          return;
        }

        // Build disable context
        const disableCtx = {
          org: { id: this.orgId },
          logger: this.logger,
        };

        // Execute disable hook
        await executeOnDisable(
          this.plugin,
          disableCtx as any,
          this.logger
        );

        res.json({ success: true });
        this.logger.info('Handled /disable, plugin cleanup completed');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error('Error in /disable endpoint', { error: errorMsg });
        res.status(500).json({
          success: false,
          error: errorMsg
        });
      }
    });
  }

  /**
   * Setup MCP proxy endpoints.
   *
   * These endpoints allow Hay Core to interact with MCP servers:
   * - POST /mcp/call-tool - Proxy MCP tool calls
   * - GET /mcp/list-tools - List available MCP tools
   *
   * @see PLUGIN_SDK_V2_MIGRATION_PLAN.md Section 0
   */
  private setupMcpEndpoints(): void {
    // POST /mcp/call-tool
    this.app.post('/mcp/call-tool', async (req: Request, res: Response): Promise<void> => {
      try {
        const { toolName, arguments: toolArgs } = req.body;

        if (!toolName || typeof toolName !== 'string') {
          res.status(400).json({
            error: 'Tool name is required and must be a string'
          });
          return;
        }

        this.logger.debug('MCP tool call requested', { toolName, arguments: toolArgs });

        // Find which MCP server has this tool
        let targetServer: RegisteredMcpServer | null = null;

        for (const server of this.mcpServers.values()) {
          if (server.type === 'local' && server.instance?.callTool) {
            // Check if this server has the tool
            // For now, we'll try the first local server (could be enhanced with tool registry)
            targetServer = server;
            break;
          }
        }

        if (!targetServer) {
          res.status(404).json({
            error: `No MCP server found for tool: ${toolName}`
          });
          return;
        }

        // Call the tool on the MCP server instance
        if (targetServer.instance?.callTool) {
          try {
            const result = await targetServer.instance.callTool(toolName, toolArgs || {});
            res.json(result);
            this.logger.debug('MCP tool call successful', { toolName, serverId: targetServer.id });
          } catch (toolErr: any) {
            const errorMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
            this.logger.error('MCP tool execution failed', { toolName, error: errorMsg });
            res.status(500).json({
              error: `Tool execution failed: ${errorMsg}`
            });
          }
        } else {
          res.status(500).json({
            error: 'MCP server does not support tool calling'
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error('Error in /mcp/call-tool endpoint', { error: errorMsg });
        res.status(500).json({ error: errorMsg });
      }
    });

    // GET /mcp/list-tools
    this.app.get('/mcp/list-tools', async (_req: Request, res: Response): Promise<void> => {
      try {
        this.logger.debug('MCP tools list requested');
        this.logger.debug(`Total MCP servers registered: ${this.mcpServers.size}`);

        const tools: any[] = [];

        // Collect tools from all registered MCP servers
        for (const server of this.mcpServers.values()) {
          this.logger.debug(`Processing MCP server ${server.id}`, { type: server.type });

          // Handle local MCP servers
          if (server.type === 'local' && server.instance?.listTools) {
            try {
              const serverTools = await server.instance.listTools();

              // Add serverId to each tool
              for (const tool of serverTools) {
                tools.push({
                  ...tool,
                  serverId: server.id
                });
              }

              this.logger.debug(`Collected ${serverTools.length} tools from local MCP server ${server.id}`);
            } catch (listErr: any) {
              const errorMsg = listErr instanceof Error ? listErr.message : String(listErr);
              this.logger.warn(`Failed to list tools from local MCP server ${server.id}`, { error: errorMsg });
            }
          }

          // Handle external MCP servers
          else if (server.type === 'external' && server.options) {
            try {
              const { url, authHeaders } = server.options;
              this.logger.debug(`Fetching tools from external MCP server ${server.id}`, { url });

              // MCP uses JSON-RPC 2.0 over HTTP
              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...authHeaders,
              };

              // Send JSON-RPC request for tools/list
              const rpcRequest = {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {}
              };

              this.logger.debug(`Sending JSON-RPC request to ${url}`, { method: rpcRequest.method });

              const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(rpcRequest),
                signal: AbortSignal.timeout(10000), // 10 second timeout for external servers
              });

              if (!response.ok) {
                const errorText = await response.text();
                this.logger.warn(`External MCP server ${server.id} returned error`, {
                  status: response.status,
                  statusText: response.statusText,
                  body: errorText
                });
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }

              const rpcResponse: any = await response.json();
              this.logger.debug(`Received JSON-RPC response from ${server.id}`, {
                hasResult: !!rpcResponse.result,
                hasError: !!rpcResponse.error
              });

              // Check for JSON-RPC error
              if (rpcResponse.error) {
                throw new Error(`MCP RPC error: ${rpcResponse.error.message || JSON.stringify(rpcResponse.error)}`);
              }

              // Extract tools from JSON-RPC result
              const serverTools = Array.isArray(rpcResponse.result?.tools) ? rpcResponse.result.tools : [];

              // Add serverId to each tool
              for (const tool of serverTools) {
                tools.push({
                  ...tool,
                  serverId: server.id
                });
              }

              this.logger.debug(`Collected ${serverTools.length} tools from external MCP server ${server.id}`);
            } catch (fetchErr: any) {
              const errorMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
              this.logger.warn(`Failed to fetch tools from external MCP server ${server.id}`, { error: errorMsg });
            }
          }
        }

        res.json({ tools });
        this.logger.debug(`Returned ${tools.length} total MCP tools`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error('Error in /mcp/list-tools endpoint', { error: errorMsg });
        res.status(500).json({ error: errorMsg });
      }
    });
  }

  /**
   * Setup plugin-registered routes.
   *
   * Mounts all routes registered via `register.route()`.
   */
  private setupPluginRoutes(): void {
    const routes = this.registry.getRoutes();

    for (const route of routes) {
      const { method, path, handler } = route;

      // Map HTTP method to Express method
      const expressMethod = method.toLowerCase() as
        | 'get'
        | 'post'
        | 'put'
        | 'patch'
        | 'delete';

      // Register the route
      this.app[expressMethod](path, async (req: Request, res: Response) => {
        try {
          this.logger.debug(`Handling ${method} ${path}`);
          await handler(req, res);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Error in route handler ${method} ${path}`, {
            error: errorMsg,
          });

          if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
          }
        }
      });

      this.logger.debug(`Registered route: ${method} ${path}`);
    }
  }

  /**
   * Setup error handler middleware.
   */
  private setupErrorHandler(): void {
    this.app.use((err: any, _req: Request, res: Response, _next: any) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('Unhandled error in HTTP server', { error: errorMsg });

      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  /**
   * Start the HTTP server.
   *
   * @returns Promise that resolves when server is listening
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          this.logger.info(`HTTP server listening on port ${this.port}`);
          resolve();
        });

        this.server.on('error', (err) => {
          this.logger.error('HTTP server error', { error: err.message });
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the HTTP server gracefully.
   *
   * @returns Promise that resolves when server is closed
   */
  async stop(): Promise<void> {
    if (!this.server) {
      this.logger.debug('HTTP server not running, nothing to stop');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          this.logger.error('Error stopping HTTP server', { error: err.message });
          reject(err);
        } else {
          this.logger.info('HTTP server stopped');
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get Express app instance (for testing).
   *
   * @internal
   */
  getApp(): Express {
    return this.app;
  }
}
