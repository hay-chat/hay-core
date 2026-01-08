/**
 * Hay Plugin SDK - HTTP Route Types
 *
 * Types for registering HTTP routes in plugins.
 *
 * @module @hay/plugin-sdk/types/route
 */

/**
 * HTTP method type.
 *
 * Supported HTTP methods for plugin routes.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Route handler function.
 *
 * Express-compatible route handler for plugin routes.
 *
 * @remarks
 * Route handlers use Express request/response objects.
 * The actual types will use `@types/express` in the implementation,
 * but we use `any` here to avoid external type dependencies in the SDK types.
 *
 * Handlers can be synchronous or asynchronous.
 *
 * @param req - Express request object
 * @param res - Express response object
 *
 * @example
 * ```typescript
 * register.route('POST', '/webhook', async (req, res) => {
 *   const payload = req.body;
 *   logger.info('Received webhook', { payload });
 *
 *   // Process webhook...
 *
 *   res.status(200).json({ ok: true });
 * });
 * ```
 *
 * @see PLUGIN.md Section 5.2.1 (lines 360-383)
 */
export type RouteHandler = (req: any, res: any) => void | Promise<void>;
