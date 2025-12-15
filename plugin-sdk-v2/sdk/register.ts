/**
 * Hay Plugin SDK v2 - Register API Implementation
 *
 * Implementation of the registration API for declaring plugin capabilities.
 *
 * @module @hay/plugin-sdk-v2/sdk/register
 */

import type {
  HayRegisterAPI,
  RegisterAuthAPI,
  ConfigFieldDescriptor,
  ApiKeyAuthOptions,
  OAuth2AuthOptions,
  HttpMethod,
  RouteHandler,
  UIExtensionDescriptor,
} from '../types/index.js';
import { PluginRegistry } from './registry.js';
import type { HayLogger } from '../types/index.js';

/**
 * Plugin manifest structure (minimal).
 *
 * Used for validating env var allowlist.
 *
 * @internal
 */
export interface PluginManifest {
  /**
   * Array of allowed environment variable names.
   * If undefined, no env vars are allowed.
   */
  env?: string[];
}

/**
 * Register API options.
 *
 * @internal
 */
export interface RegisterAPIOptions {
  /**
   * Plugin registry for storing registrations.
   */
  registry: PluginRegistry;

  /**
   * Plugin manifest (for env var validation).
   */
  manifest?: PluginManifest;

  /**
   * Logger for validation warnings/errors.
   */
  logger: HayLogger;
}

/**
 * Create a Register API instance.
 *
 * @param options - Register API options
 * @returns Register API implementation
 *
 * @internal
 */
export function createRegisterAPI(options: RegisterAPIOptions): HayRegisterAPI {
  const { registry, manifest, logger } = options;

  // Create auth sub-API
  const auth: RegisterAuthAPI = {
    apiKey(authOptions: ApiKeyAuthOptions): void {
      // Validate auth options
      validateApiKeyAuthOptions(authOptions, registry);

      // Register the auth method
      registry.registerAuthMethod(authOptions);

      logger.debug('Registered API key auth method', { id: authOptions.id });
    },

    oauth2(authOptions: OAuth2AuthOptions): void {
      // Validate auth options
      validateOAuth2AuthOptions(authOptions, registry);

      // Register the auth method
      registry.registerAuthMethod(authOptions);

      logger.debug('Registered OAuth2 auth method', { id: authOptions.id });
    },
  };

  // Create main register API
  const registerAPI: HayRegisterAPI = {
    route(method: HttpMethod, path: string, handler: RouteHandler): void {
      // Validate inputs
      validateHttpMethod(method);
      validateRoutePath(path);
      validateRouteHandler(handler);

      // Register the route
      registry.registerRoute({ method, path, handler });

      logger.debug('Registered route', { method, path });
    },

    config(schema: Record<string, ConfigFieldDescriptor>): void {
      // Validate schema
      validateConfigSchema(schema, manifest, logger);

      // Register the config
      registry.registerConfig(schema);

      const fieldCount = Object.keys(schema).length;
      logger.debug('Registered config schema', { fields: fieldCount });
    },

    ui(extension: UIExtensionDescriptor): void {
      // Validate extension
      validateUIExtension(extension);

      // Register the UI extension
      registry.registerUIExtension(extension);

      logger.debug('Registered UI extension', { slot: extension.slot });
    },

    auth,
  };

  return registerAPI;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate HTTP method.
 *
 * @param method - HTTP method to validate
 * @throws {Error} If method is invalid
 *
 * @internal
 */
function validateHttpMethod(method: HttpMethod): void {
  const validMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  if (!validMethods.includes(method)) {
    throw new Error(
      `Invalid HTTP method: ${method}. Must be one of: ${validMethods.join(', ')}`,
    );
  }
}

/**
 * Validate route path.
 *
 * @param path - Route path to validate
 * @throws {Error} If path is invalid
 *
 * @internal
 */
function validateRoutePath(path: string): void {
  if (!path || typeof path !== 'string') {
    throw new Error('Route path must be a non-empty string');
  }

  if (!path.startsWith('/')) {
    throw new Error(`Route path must start with "/": ${path}`);
  }
}

/**
 * Validate route handler.
 *
 * @param handler - Route handler to validate
 * @throws {Error} If handler is invalid
 *
 * @internal
 */
function validateRouteHandler(handler: RouteHandler): void {
  if (typeof handler !== 'function') {
    throw new Error('Route handler must be a function');
  }
}

/**
 * Validate config schema.
 *
 * @param schema - Config schema to validate
 * @param manifest - Plugin manifest (for env validation)
 * @param logger - Logger for warnings
 * @throws {Error} If schema is invalid
 *
 * @internal
 */
function validateConfigSchema(
  schema: Record<string, ConfigFieldDescriptor>,
  manifest: PluginManifest | undefined,
  _logger: HayLogger,
): void {
  if (!schema || typeof schema !== 'object') {
    throw new Error('Config schema must be an object');
  }

  const allowedEnvVars = manifest?.env || [];

  for (const [fieldName, descriptor] of Object.entries(schema)) {
    // Validate field name
    if (!fieldName || typeof fieldName !== 'string') {
      throw new Error('Config field name must be a non-empty string');
    }

    // Validate descriptor
    if (!descriptor || typeof descriptor !== 'object') {
      throw new Error(`Config field "${fieldName}" descriptor must be an object`);
    }

    // Validate type
    const validTypes = ['string', 'number', 'boolean', 'json'];
    if (!validTypes.includes(descriptor.type)) {
      throw new Error(
        `Config field "${fieldName}" has invalid type: ${descriptor.type}. Must be one of: ${validTypes.join(', ')}`,
      );
    }

    // Validate env var (if specified)
    if (descriptor.env) {
      if (typeof descriptor.env !== 'string') {
        throw new Error(
          `Config field "${fieldName}" env must be a string`,
        );
      }

      // Check if env var is in manifest allowlist
      if (!allowedEnvVars.includes(descriptor.env)) {
        throw new Error(
          `Config field "${fieldName}" references env var "${descriptor.env}" which is not in manifest allowlist. ` +
          `Add "${descriptor.env}" to the "env" array in package.json hay-plugin configuration.`,
        );
      }
    }

    // Validate default value type (if provided)
    if (descriptor.default !== undefined) {
      validateDefaultValue(fieldName, descriptor);
    }
  }
}

/**
 * Validate default value matches field type.
 *
 * @param fieldName - Field name (for error messages)
 * @param descriptor - Field descriptor
 *
 * @internal
 */
function validateDefaultValue(
  fieldName: string,
  descriptor: ConfigFieldDescriptor,
): void {
  const { type, default: defaultValue } = descriptor;

  let valid = false;

  switch (type) {
    case 'string':
      valid = typeof defaultValue === 'string';
      break;
    case 'number':
      valid = typeof defaultValue === 'number' && !isNaN(defaultValue);
      break;
    case 'boolean':
      valid = typeof defaultValue === 'boolean';
      break;
    case 'json':
      // JSON can be any type (object, array, etc.)
      valid = true;
      break;
  }

  if (!valid) {
    throw new Error(
      `Config field "${fieldName}" default value has wrong type. Expected ${type}, got ${typeof defaultValue}`,
    );
  }
}

/**
 * Validate API key auth options.
 *
 * @param options - Auth options to validate
 * @param registry - Plugin registry (to check config fields)
 * @throws {Error} If options are invalid
 *
 * @internal
 */
function validateApiKeyAuthOptions(
  options: ApiKeyAuthOptions,
  registry: PluginRegistry,
): void {
  if (!options || typeof options !== 'object') {
    throw new Error('API key auth options must be an object');
  }

  // Validate id
  if (!options.id || typeof options.id !== 'string') {
    throw new Error('API key auth id must be a non-empty string');
  }

  // Validate label
  if (!options.label || typeof options.label !== 'string') {
    throw new Error('API key auth label must be a non-empty string');
  }

  // Validate configField
  if (!options.configField || typeof options.configField !== 'string') {
    throw new Error('API key auth configField must be a non-empty string');
  }

  // Verify config field exists
  if (!registry.hasConfigField(options.configField)) {
    throw new Error(
      `API key auth references config field "${options.configField}" which hasn't been registered. ` +
      `Register config schema before registering auth methods.`,
    );
  }
}

/**
 * Validate OAuth2 auth options.
 *
 * @param options - Auth options to validate
 * @param registry - Plugin registry (to check config fields)
 * @throws {Error} If options are invalid
 *
 * @internal
 */
function validateOAuth2AuthOptions(
  options: OAuth2AuthOptions,
  registry: PluginRegistry,
): void {
  if (!options || typeof options !== 'object') {
    throw new Error('OAuth2 auth options must be an object');
  }

  // Validate id
  if (!options.id || typeof options.id !== 'string') {
    throw new Error('OAuth2 auth id must be a non-empty string');
  }

  // Validate label
  if (!options.label || typeof options.label !== 'string') {
    throw new Error('OAuth2 auth label must be a non-empty string');
  }

  // Validate authorizationUrl
  if (!options.authorizationUrl || typeof options.authorizationUrl !== 'string') {
    throw new Error('OAuth2 auth authorizationUrl must be a non-empty string');
  }

  // Validate tokenUrl
  if (!options.tokenUrl || typeof options.tokenUrl !== 'string') {
    throw new Error('OAuth2 auth tokenUrl must be a non-empty string');
  }

  // Validate clientId field reference
  if (!options.clientId || typeof options.clientId !== 'object') {
    throw new Error('OAuth2 auth clientId must be a ConfigFieldReference object');
  }

  if (!options.clientId.name || typeof options.clientId.name !== 'string') {
    throw new Error('OAuth2 auth clientId.name must be a non-empty string');
  }

  if (!registry.hasConfigField(options.clientId.name)) {
    throw new Error(
      `OAuth2 auth clientId references config field "${options.clientId.name}" which hasn't been registered. ` +
      `Register config schema before registering auth methods.`,
    );
  }

  // Validate clientSecret field reference
  if (!options.clientSecret || typeof options.clientSecret !== 'object') {
    throw new Error('OAuth2 auth clientSecret must be a ConfigFieldReference object');
  }

  if (!options.clientSecret.name || typeof options.clientSecret.name !== 'string') {
    throw new Error('OAuth2 auth clientSecret.name must be a non-empty string');
  }

  if (!registry.hasConfigField(options.clientSecret.name)) {
    throw new Error(
      `OAuth2 auth clientSecret references config field "${options.clientSecret.name}" which hasn't been registered. ` +
      `Register config schema before registering auth methods.`,
    );
  }

  // Validate scopes (if provided)
  if (options.scopes !== undefined) {
    if (!Array.isArray(options.scopes)) {
      throw new Error('OAuth2 auth scopes must be an array');
    }

    for (const scope of options.scopes) {
      if (typeof scope !== 'string') {
        throw new Error('OAuth2 auth scopes must be an array of strings');
      }
    }
  }
}

/**
 * Validate UI extension.
 *
 * @param extension - UI extension to validate
 * @throws {Error} If extension is invalid
 *
 * @internal
 */
function validateUIExtension(extension: UIExtensionDescriptor): void {
  if (!extension || typeof extension !== 'object') {
    throw new Error('UI extension must be an object');
  }

  // Validate slot
  if (!extension.slot || typeof extension.slot !== 'string') {
    throw new Error('UI extension slot must be a non-empty string');
  }

  // Validate component
  if (!extension.component || typeof extension.component !== 'string') {
    throw new Error('UI extension component must be a non-empty string');
  }
}
