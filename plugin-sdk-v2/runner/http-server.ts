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
import type { HayLogger } from '../types/index.js';
import { PluginRegistry } from '../sdk/registry.js';

/**
 * Plugin HTTP server instance.
 *
 * Wraps Express server with plugin-specific functionality.
 */
export class PluginHttpServer {
  private app: Express;
  private server: Server | null = null;
  private port: number;
  private logger: HayLogger;
  private registry: PluginRegistry;

  constructor(port: number, registry: PluginRegistry, logger: HayLogger) {
    this.port = port;
    this.logger = logger;
    this.registry = registry;
    this.app = express();

    // Middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Setup routes
    this.setupMetadataEndpoint();
    this.setupPluginRoutes();
    this.setupErrorHandler();
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
