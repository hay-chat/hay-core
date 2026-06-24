/**
 * Hay Plugin SDK - Register API Implementation
 *
 * Implementation of the registration API for declaring plugin capabilities.
 *
 * @module @hay/plugin-sdk/sdk/register
 */

import type {
  HayRegisterAPI,
  RegisterAuthAPI,
  UIRegistrationAPI,
  ConfigFieldDescriptor,
  ApiKeyAuthOptions,
  OAuth2AuthOptions,
  HttpMethod,
  RouteHandler,
  PluginPage,
  CronJobOptions,
  WebhookRoutingDescriptor,
} from "../types/index.js";
import { PluginRegistry } from "./registry.js";
import type { HayLogger } from "../types/index.js";

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

      logger.debug("Registered API key auth method", { id: authOptions.id });
    },

    oauth2(authOptions: OAuth2AuthOptions): void {
      // Validate auth options
      validateOAuth2AuthOptions(authOptions, registry);

      // Register the auth method
      registry.registerAuthMethod(authOptions);

      logger.debug("Registered OAuth2 auth method", { id: authOptions.id });
    },
  };

  // Create UI registration API
  const uiRegistrationAPI: UIRegistrationAPI = {
    page(page: PluginPage): void {
      // Validate page
      validatePluginPage(page);

      // Register the UI page
      registry.registerUIPage(page);

      logger.debug("Registered UI page", { id: page.id, slot: page.slot });
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

      logger.debug("Registered route", { method, path });
    },

    config(schema: Record<string, ConfigFieldDescriptor>): void {
      // Validate schema
      validateConfigSchema(schema, manifest, logger);

      // Register the config
      registry.registerConfig(schema);

      const fieldCount = Object.keys(schema).length;
      logger.debug("Registered config schema", { fields: fieldCount });
    },

    ui: uiRegistrationAPI,

    auth,

    cron(cronOptions: CronJobOptions): void {
      validateCronOptions(cronOptions);

      registry.registerCronJob(cronOptions);

      logger.debug("Registered cron job", {
        name: cronOptions.name,
        schedule: cronOptions.schedule,
      });
    },

    webhookRouting(descriptor: WebhookRoutingDescriptor): void {
      validateWebhookRouting(descriptor);

      registry.registerWebhookRouting(descriptor);

      logger.debug("Registered webhook routing strategy", {
        signatureHeader: descriptor.signature.header,
        itemsPath: descriptor.routeKeyPath.itemsPath,
      });
    },
  };

  return registerAPI;
}

/**
 * Validate cron job options.
 *
 * @param options - Cron options to validate
 * @throws {Error} If options are invalid
 *
 * @internal
 */
function validateCronOptions(options: CronJobOptions): void {
  if (!options || typeof options !== "object") {
    throw new Error("Cron options must be an object");
  }

  if (!options.name || typeof options.name !== "string") {
    throw new Error("Cron job name must be a non-empty string");
  }

  if (!/^[a-z0-9_-]+$/i.test(options.name)) {
    throw new Error(
      `Cron job name "${options.name}" must contain only letters, numbers, hyphens and underscores`,
    );
  }

  if (!options.schedule || typeof options.schedule !== "string") {
    throw new Error("Cron job schedule must be a non-empty cron expression string");
  }

  // 5-field cron expression (minute hour day-of-month month day-of-week).
  const fieldCount = options.schedule.trim().split(/\s+/).length;
  if (fieldCount !== 5) {
    throw new Error(`Cron job schedule "${options.schedule}" must be a 5-field cron expression`);
  }

  if (typeof options.handler !== "function") {
    throw new Error("Cron job handler must be a function");
  }

  if (options.retryPolicy !== undefined) {
    const { maxRetries, backoff } = options.retryPolicy;
    if (maxRetries !== undefined && (typeof maxRetries !== "number" || maxRetries < 0)) {
      throw new Error("Cron job retryPolicy.maxRetries must be a non-negative number");
    }
    if (backoff !== undefined && backoff !== "fixed" && backoff !== "exponential") {
      throw new Error('Cron job retryPolicy.backoff must be "fixed" or "exponential"');
    }
  }
}

/**
 * Validate a webhook routing descriptor.
 *
 * @param descriptor - Webhook routing descriptor to validate
 * @throws {Error} If the descriptor is invalid
 *
 * @internal
 */
function validateWebhookRouting(descriptor: WebhookRoutingDescriptor): void {
  if (!descriptor || typeof descriptor !== "object") {
    throw new Error("Webhook routing descriptor must be an object");
  }

  const { signature, verificationChallenge, routeKeyPath } = descriptor;

  if (!signature || typeof signature !== "object") {
    throw new Error("Webhook routing signature must be an object");
  }
  if (!signature.header || typeof signature.header !== "string") {
    throw new Error("Webhook routing signature.header must be a non-empty string");
  }
  if (signature.format !== "sha256-hmac") {
    throw new Error('Webhook routing signature.format must be "sha256-hmac"');
  }
  if (!signature.secretEnv || typeof signature.secretEnv !== "string") {
    throw new Error("Webhook routing signature.secretEnv must be a non-empty string");
  }

  if (!routeKeyPath || typeof routeKeyPath !== "object") {
    throw new Error("Webhook routing routeKeyPath must be an object");
  }
  if (!routeKeyPath.itemsPath || typeof routeKeyPath.itemsPath !== "string") {
    throw new Error("Webhook routing routeKeyPath.itemsPath must be a non-empty string");
  }
  if (!routeKeyPath.keyPath || typeof routeKeyPath.keyPath !== "string") {
    throw new Error("Webhook routing routeKeyPath.keyPath must be a non-empty string");
  }

  if (verificationChallenge !== undefined) {
    if (typeof verificationChallenge !== "object" || verificationChallenge === null) {
      throw new Error("Webhook routing verificationChallenge must be an object");
    }
    const { modeParam, verifyTokenParam, challengeParam, verifyTokenConfigField, verifyTokenEnv } =
      verificationChallenge;
    if (!modeParam || typeof modeParam !== "string") {
      throw new Error("Webhook routing verificationChallenge.modeParam must be a non-empty string");
    }
    if (!verifyTokenParam || typeof verifyTokenParam !== "string") {
      throw new Error(
        "Webhook routing verificationChallenge.verifyTokenParam must be a non-empty string",
      );
    }
    if (!challengeParam || typeof challengeParam !== "string") {
      throw new Error(
        "Webhook routing verificationChallenge.challengeParam must be a non-empty string",
      );
    }
    if (verifyTokenConfigField !== undefined && typeof verifyTokenConfigField !== "string") {
      throw new Error(
        "Webhook routing verificationChallenge.verifyTokenConfigField must be a string",
      );
    }
    if (verifyTokenEnv !== undefined && typeof verifyTokenEnv !== "string") {
      throw new Error("Webhook routing verificationChallenge.verifyTokenEnv must be a string");
    }
    if (!verifyTokenConfigField && !verifyTokenEnv) {
      throw new Error(
        "Webhook routing verificationChallenge requires verifyTokenConfigField or verifyTokenEnv",
      );
    }
  }
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
  const validMethods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

  if (!validMethods.includes(method)) {
    throw new Error(`Invalid HTTP method: ${method}. Must be one of: ${validMethods.join(", ")}`);
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
  if (!path || typeof path !== "string") {
    throw new Error("Route path must be a non-empty string");
  }

  if (!path.startsWith("/")) {
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
  if (typeof handler !== "function") {
    throw new Error("Route handler must be a function");
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
  if (!schema || typeof schema !== "object") {
    throw new Error("Config schema must be an object");
  }

  const allowedEnvVars = manifest?.env || [];

  for (const [fieldName, descriptor] of Object.entries(schema)) {
    // Validate field name
    if (!fieldName || typeof fieldName !== "string") {
      throw new Error("Config field name must be a non-empty string");
    }

    // Validate descriptor
    if (!descriptor || typeof descriptor !== "object") {
      throw new Error(`Config field "${fieldName}" descriptor must be an object`);
    }

    // Validate type
    const validTypes = ["string", "number", "boolean", "json"];
    if (!validTypes.includes(descriptor.type)) {
      throw new Error(
        `Config field "${fieldName}" has invalid type: ${descriptor.type}. Must be one of: ${validTypes.join(", ")}`,
      );
    }

    // Validate env var (if specified)
    if (descriptor.env) {
      if (typeof descriptor.env !== "string") {
        throw new Error(`Config field "${fieldName}" env must be a string`);
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
function validateDefaultValue(fieldName: string, descriptor: ConfigFieldDescriptor): void {
  const { type, default: defaultValue } = descriptor;

  let valid = false;

  switch (type) {
    case "string":
      valid = typeof defaultValue === "string";
      break;
    case "number":
      valid = typeof defaultValue === "number" && !isNaN(defaultValue);
      break;
    case "boolean":
      valid = typeof defaultValue === "boolean";
      break;
    case "json":
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
function validateApiKeyAuthOptions(options: ApiKeyAuthOptions, registry: PluginRegistry): void {
  if (!options || typeof options !== "object") {
    throw new Error("API key auth options must be an object");
  }

  // Validate id
  if (!options.id || typeof options.id !== "string") {
    throw new Error("API key auth id must be a non-empty string");
  }

  // Validate label
  if (!options.label || typeof options.label !== "string") {
    throw new Error("API key auth label must be a non-empty string");
  }

  // Validate configField
  if (!options.configField || typeof options.configField !== "string") {
    throw new Error("API key auth configField must be a non-empty string");
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
function validateOAuth2AuthOptions(options: OAuth2AuthOptions, registry: PluginRegistry): void {
  if (!options || typeof options !== "object") {
    throw new Error("OAuth2 auth options must be an object");
  }

  // Validate id
  if (!options.id || typeof options.id !== "string") {
    throw new Error("OAuth2 auth id must be a non-empty string");
  }

  // Validate label
  if (!options.label || typeof options.label !== "string") {
    throw new Error("OAuth2 auth label must be a non-empty string");
  }

  // Validate authorizationUrl
  if (!options.authorizationUrl || typeof options.authorizationUrl !== "string") {
    throw new Error("OAuth2 auth authorizationUrl must be a non-empty string");
  }

  // Validate tokenUrl
  if (!options.tokenUrl || typeof options.tokenUrl !== "string") {
    throw new Error("OAuth2 auth tokenUrl must be a non-empty string");
  }

  // Validate clientId field reference
  if (!options.clientId || typeof options.clientId !== "object") {
    throw new Error("OAuth2 auth clientId must be a ConfigFieldReference object");
  }

  if (!options.clientId.name || typeof options.clientId.name !== "string") {
    throw new Error("OAuth2 auth clientId.name must be a non-empty string");
  }

  if (!registry.hasConfigField(options.clientId.name)) {
    throw new Error(
      `OAuth2 auth clientId references config field "${options.clientId.name}" which hasn't been registered. ` +
        `Register config schema before registering auth methods.`,
    );
  }

  // Validate clientSecret field reference
  if (!options.clientSecret || typeof options.clientSecret !== "object") {
    throw new Error("OAuth2 auth clientSecret must be a ConfigFieldReference object");
  }

  if (!options.clientSecret.name || typeof options.clientSecret.name !== "string") {
    throw new Error("OAuth2 auth clientSecret.name must be a non-empty string");
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
      throw new Error("OAuth2 auth scopes must be an array");
    }

    for (const scope of options.scopes) {
      if (typeof scope !== "string") {
        throw new Error("OAuth2 auth scopes must be an array of strings");
      }
    }
  }

  // Validate authorizationParams (if provided)
  if (options.authorizationParams !== undefined) {
    if (
      typeof options.authorizationParams !== "object" ||
      options.authorizationParams === null ||
      Array.isArray(options.authorizationParams)
    ) {
      throw new Error("OAuth2 auth authorizationParams must be a plain object");
    }

    for (const value of Object.values(options.authorizationParams)) {
      if (typeof value !== "string") {
        throw new Error("OAuth2 auth authorizationParams values must all be strings");
      }
    }
  }
}

/**
 * Validate plugin page.
 *
 * @param page - Plugin page to validate
 * @throws {Error} If page is invalid
 *
 * @internal
 */
function validatePluginPage(page: PluginPage): void {
  if (!page || typeof page !== "object") {
    throw new Error("Plugin page must be an object");
  }

  // Validate id
  if (!page.id || typeof page.id !== "string") {
    throw new Error("Plugin page id must be a non-empty string");
  }

  // Validate title
  if (!page.title || typeof page.title !== "string") {
    throw new Error("Plugin page title must be a non-empty string");
  }

  // Validate component
  if (!page.component || typeof page.component !== "string") {
    throw new Error("Plugin page component must be a non-empty string");
  }

  // Validate slot (if provided)
  if (page.slot !== undefined) {
    const validSlots = ["standalone", "after-settings", "before-settings"];
    if (!validSlots.includes(page.slot)) {
      throw new Error(
        `Plugin page slot must be one of: ${validSlots.join(", ")}. Got: ${page.slot}`,
      );
    }
  }

  // Validate icon (if provided)
  if (page.icon !== undefined && typeof page.icon !== "string") {
    throw new Error("Plugin page icon must be a string");
  }

  // Validate requiresSetup (if provided)
  if (page.requiresSetup !== undefined && typeof page.requiresSetup !== "boolean") {
    throw new Error("Plugin page requiresSetup must be a boolean");
  }
}
