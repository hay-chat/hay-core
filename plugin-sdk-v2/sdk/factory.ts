/**
 * Hay Plugin SDK v2 - Plugin Factory Implementation
 *
 * Core factory function for creating Hay plugins.
 *
 * @module @hay/plugin-sdk-v2/sdk/factory
 */

import type {
  HayPluginFactory,
  HayPluginDefinition,
  HayGlobalContext,
} from '../types';

/**
 * Define a Hay plugin.
 *
 * This is the main entry point for creating a Hay plugin.
 * The factory function receives a global context and should return a plugin definition.
 *
 * @param factory - Factory function that receives global context and returns plugin definition
 * @returns The plugin definition returned by the factory
 *
 * @remarks
 * The factory pattern allows plugins to capture the global context during initialization
 * and use it across multiple hooks without explicit parameter passing.
 *
 * **Validation**:
 * - Ensures the factory returns a valid plugin definition
 * - Validates that `name` field is present and non-empty
 * - Type-checks all hook signatures
 *
 * **Usage**:
 * The factory function receives a `HayGlobalContext` which provides:
 * - `register` - API for registering config, auth, routes, UI
 * - `config` - API for creating config field references
 * - `logger` - Logger for plugin messages
 *
 * @example
 * ```typescript
 * import { defineHayPlugin } from '@hay/plugin-sdk-v2';
 *
 * export default defineHayPlugin((globalCtx) => {
 *   const { register, config, logger } = globalCtx;
 *
 *   return {
 *     name: 'Shopify',
 *
 *     onInitialize() {
 *       register.config({
 *         apiKey: {
 *           type: 'string',
 *           required: true,
 *           env: 'SHOPIFY_API_KEY',
 *           sensitive: true,
 *         },
 *       });
 *
 *       register.auth.apiKey({
 *         id: 'apiKey',
 *         label: 'API Key',
 *         configField: 'apiKey',
 *       });
 *
 *       register.route('POST', '/webhook', async (req, res) => {
 *         logger.info('Webhook received');
 *         res.json({ ok: true });
 *       });
 *     },
 *
 *     async onStart(ctx) {
 *       const { org, config, auth, mcp, logger } = ctx;
 *       logger.info(`Starting plugin for org: ${org.id}`);
 *
 *       const authState = auth.get();
 *       if (!authState) {
 *         logger.warn('No auth configured');
 *         return;
 *       }
 *
 *       const apiKey = String(authState.credentials.apiKey);
 *
 *       await mcp.startLocal('shopify-orders', () => {
 *         return new ShopifyOrdersMcpServer({ apiKey, logger });
 *       });
 *     },
 *
 *     async onValidateAuth(ctx) {
 *       const authState = ctx.auth.get();
 *       if (!authState) return false;
 *
 *       const apiKey = String(authState.credentials.apiKey);
 *       const client = new ShopifyClient(apiKey);
 *       return await client.verify();
 *     },
 *
 *     onDisable(ctx) {
 *       ctx.logger.info(`Plugin disabled for org: ${ctx.org.id}`);
 *     },
 *   };
 * });
 * ```
 *
 * @throws {PluginDefinitionError} If the factory returns an invalid plugin definition
 *
 * @see {@link HayPluginFactory}
 * @see {@link HayPluginDefinition}
 * @see {@link HayGlobalContext}
 * @see PLUGIN.md Section 5.1 (lines 302-327)
 */
export function defineHayPlugin(
  factory: HayPluginFactory,
): HayPluginFactory {
  // Type guard: ensure factory is a function
  if (typeof factory !== 'function') {
    throw new PluginDefinitionError(
      'defineHayPlugin: factory must be a function',
    );
  }

  // Return a wrapped factory that adds validation
  return (globalCtx: HayGlobalContext): HayPluginDefinition => {
    // Call the user's factory function
    const definition = factory(globalCtx);

    // Validate the returned definition
    validatePluginDefinition(definition);

    return definition;
  };
}

/**
 * Validate a plugin definition.
 *
 * Ensures the plugin definition has all required fields and valid structure.
 *
 * @param definition - Plugin definition to validate
 * @throws {PluginDefinitionError} If validation fails
 *
 * @internal
 */
function validatePluginDefinition(definition: unknown): asserts definition is HayPluginDefinition {
  // Check if definition is an object
  if (!definition || typeof definition !== 'object') {
    throw new PluginDefinitionError(
      'Plugin definition must be an object',
    );
  }

  const def = definition as Partial<HayPluginDefinition>;

  // Validate required 'name' field
  if (!def.name || typeof def.name !== 'string') {
    throw new PluginDefinitionError(
      'Plugin definition must have a non-empty "name" field',
    );
  }

  if (def.name.trim().length === 0) {
    throw new PluginDefinitionError(
      'Plugin name cannot be empty or whitespace',
    );
  }

  // Validate hook types (if provided)
  const hooks = [
    'onInitialize',
    'onStart',
    'onValidateAuth',
    'onConfigUpdate',
    'onDisable',
    'onEnable',
  ] as const;

  for (const hook of hooks) {
    if (def[hook] !== undefined && typeof def[hook] !== 'function') {
      throw new PluginDefinitionError(
        `Plugin hook "${hook}" must be a function (got ${typeof def[hook]})`,
      );
    }
  }
}

/**
 * Error thrown when plugin definition validation fails.
 *
 * @remarks
 * This error is thrown by {@link defineHayPlugin} when:
 * - Factory is not a function
 * - Plugin definition is not an object
 * - Required `name` field is missing or invalid
 * - Hook functions have invalid types
 */
export class PluginDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginDefinitionError';

    // Maintain proper stack trace for where our error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PluginDefinitionError);
    }
  }
}
