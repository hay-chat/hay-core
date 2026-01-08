/**
 * Hay Plugin SDK - Runtime Config API Implementation
 *
 * Implementation of the runtime config API for reading configuration values.
 *
 * @module @hay/plugin-sdk/sdk/config-runtime
 */

import type { HayConfigRuntimeAPI } from "../types/index.js";
import type { PluginRegistry } from "./registry.js";
import type { HayLogger } from "../types/index.js";
import type { PluginManifest } from "./register.js";

/**
 * Runtime config API options.
 *
 * @internal
 */
export interface ConfigRuntimeAPIOptions {
  /**
   * Organization-specific config values.
   * Map of field name to value.
   */
  orgConfig: Record<string, any>;

  /**
   * Plugin registry (for field descriptors).
   */
  registry: PluginRegistry;

  /**
   * Plugin manifest (for env var allowlist).
   */
  manifest?: PluginManifest;

  /**
   * Logger for warnings.
   */
  logger: HayLogger;
}

/**
 * Create a Runtime Config API instance.
 *
 * This API is used in org runtime hooks (onStart, onValidateAuth, etc.)
 * to read configuration values with the resolution pipeline:
 * 1. Org-specific config value
 * 2. Environment variable (if configured and allowed)
 * 3. Default value (if configured)
 * 4. undefined (or throw if required)
 *
 * @param options - Runtime config API options
 * @returns Runtime config API implementation
 *
 * @remarks
 * **CONSTRAINT**: This API must NOT be used in onInitialize.
 * Use `HayConfigDescriptorAPI` there instead.
 *
 * @internal
 */
export function createConfigRuntimeAPI(options: ConfigRuntimeAPIOptions): HayConfigRuntimeAPI {
  const { orgConfig, registry, manifest, logger } = options;

  return {
    get<T = any>(key: string): T {
      const result = resolveConfigValue(key, orgConfig, registry, manifest, logger);

      // Get field descriptor to check if required
      const descriptor = registry.getConfigField(key);

      if (result === undefined && descriptor?.required) {
        throw new Error(
          `Config field "${key}" is required but not configured. ` +
            `Please set this field in the plugin settings or provide via environment variable.`,
        );
      }

      return result as T;
    },

    getOptional<T = any>(key: string): T | undefined {
      const result = resolveConfigValue(key, orgConfig, registry, manifest, logger);
      return result as T | undefined;
    },

    keys(): string[] {
      // Return all registered config field names
      const schema = registry.getConfigSchema();
      return Object.keys(schema);
    },

    toEnv(mapping: Record<string, string>): Record<string, string> {
      const env: Record<string, string> = {};

      for (const [configKey, envVarName] of Object.entries(mapping)) {
        const value = resolveConfigValue(configKey, orgConfig, registry, manifest, logger);

        // Only add to env if value exists and is not null/undefined
        if (value !== undefined && value !== null) {
          // Convert value to string for environment variable
          env[envVarName] = String(value);
        }
      }

      return env;
    },
  };
}

/**
 * Resolve a config value using the resolution pipeline.
 *
 * Resolution order:
 * 1. Org-specific config value
 * 2. Environment variable (if field has `env` and it's in manifest allowlist)
 * 3. Default value (if field has `default`)
 * 4. undefined
 *
 * @param key - Config field name
 * @param orgConfig - Org-specific config values
 * @param registry - Plugin registry
 * @param manifest - Plugin manifest
 * @param logger - Logger for warnings
 * @returns Resolved config value or undefined
 *
 * @internal
 */
function resolveConfigValue(
  key: string,
  orgConfig: Record<string, any>,
  registry: PluginRegistry,
  manifest: PluginManifest | undefined,
  logger: HayLogger,
): any {
  // Step 1: Check org-specific config
  if (key in orgConfig && orgConfig[key] !== undefined && orgConfig[key] !== null) {
    return orgConfig[key];
  }

  // Get field descriptor
  const descriptor = registry.getConfigField(key);

  if (!descriptor) {
    logger.warn(`Config field "${key}" is not registered in schema`);
    return undefined;
  }

  // Step 2: Check environment variable (if configured)
  if (descriptor.env) {
    const envVarName = descriptor.env;
    const allowedEnvVars = manifest?.env || [];

    // Validate env var is in allowlist
    if (!allowedEnvVars.includes(envVarName)) {
      logger.warn(
        `Config field "${key}" references env var "${envVarName}" which is not in manifest allowlist`,
      );
    } else {
      // Read from process.env
      const envValue = process.env[envVarName];

      if (envValue !== undefined) {
        // Parse env value based on field type
        return parseEnvValue(envValue, descriptor.type, key, logger);
      }
    }
  }

  // Step 3: Use default value (if configured)
  if (descriptor.default !== undefined) {
    return descriptor.default;
  }

  // Step 4: Return undefined
  return undefined;
}

/**
 * Parse environment variable value based on field type.
 *
 * @param envValue - Raw environment variable value (string)
 * @param fieldType - Expected field type
 * @param fieldName - Field name (for error messages)
 * @param logger - Logger for warnings
 * @returns Parsed value
 *
 * @internal
 */
function parseEnvValue(
  envValue: string,
  fieldType: string,
  fieldName: string,
  logger: HayLogger,
): any {
  try {
    switch (fieldType) {
      case "string":
        return envValue;

      case "number": {
        const parsed = Number(envValue);
        if (isNaN(parsed)) {
          logger.warn(
            `Config field "${fieldName}" expects number but env var has non-numeric value: "${envValue}"`,
          );
          return undefined;
        }
        return parsed;
      }

      case "boolean": {
        const lower = envValue.toLowerCase().trim();
        if (lower === "true" || lower === "1" || lower === "yes") {
          return true;
        }
        if (lower === "false" || lower === "0" || lower === "no" || lower === "") {
          return false;
        }
        logger.warn(
          `Config field "${fieldName}" expects boolean but env var has invalid value: "${envValue}". Using false.`,
        );
        return false;
      }

      case "json": {
        try {
          return JSON.parse(envValue);
        } catch (err) {
          logger.warn(
            `Config field "${fieldName}" expects JSON but env var has invalid JSON: "${envValue}"`,
          );
          return undefined;
        }
      }

      default:
        logger.warn(`Config field "${fieldName}" has unknown type: ${fieldType}`);
        return envValue;
    }
  } catch (err) {
    logger.error(`Error parsing env var for config field "${fieldName}"`, err);
    return undefined;
  }
}
