import type { ConfigFieldDescriptor } from "@server/types/plugin-sdk.types";
import { decryptConfig } from "@server/lib/auth/utils/encryption";

export interface ResolvedConfigField {
  value: any;
  source: "env" | "database" | "default";
  isEncrypted: boolean;
  canOverride: boolean;
  hasEnvFallback?: boolean; // Whether field has env variable fallback available
}

export interface ResolvedConfig {
  values: Record<string, any>;
  metadata: Record<string, ResolvedConfigField>;
}

/**
 * Resolve configuration with .env fallback support
 * @param dbConfig - Configuration from database (may be encrypted)
 * @param configSchema - Schema with field definitions including env mappings
 * @param options - Resolution options
 */
export function resolveConfigWithEnv(
  dbConfig: Record<string, unknown> | undefined,
  configSchema: Record<string, ConfigFieldDescriptor>,
  options: {
    decrypt?: boolean; // Whether to decrypt values
    maskSecrets?: boolean; // Whether to mask encrypted/env values for display
  } = {},
): ResolvedConfig {
  const { decrypt = false, maskSecrets = false } = options;

  const decryptedConfig = decrypt && dbConfig ? decryptConfig(dbConfig) : dbConfig || {};
  const resolved: ResolvedConfig = {
    values: {},
    metadata: {},
  };

  for (const [key, fieldDef] of Object.entries(configSchema)) {
    const hasDbValue = key in decryptedConfig;
    const dbValue = decryptedConfig[key];
    const envVarName = fieldDef.env;
    const hasEnvFallback = !!envVarName;
    const envValue =
      hasEnvFallback && process.env[envVarName] && process.env[envVarName] !== ""
        ? process.env[envVarName]
        : undefined;

    // Resolution priority:
    // 1. Database value (if key exists in config)
    // 2. Environment variable (if field has env property)
    // 3. Default value (if specified in schema)
    // 4. undefined

    if (hasDbValue) {
      // User has explicitly set this value (or cleared it)
      resolved.values[key] = maskSecrets && fieldDef.encrypted ? "********" : dbValue;
      resolved.metadata[key] = {
        value: dbValue,
        source: "database",
        isEncrypted: !!fieldDef.encrypted,
        canOverride: false, // Already overridden
        hasEnvFallback: hasEnvFallback && envValue !== undefined, // Can reset to env if available
      };
    } else if (hasEnvFallback && envValue !== undefined) {
      // Fallback to environment variable
      // For masked mode (frontend), don't expose any value - just indicate source via metadata
      resolved.values[key] = maskSecrets ? undefined : envValue;
      resolved.metadata[key] = {
        value: envValue,
        source: "env",
        isEncrypted: !!fieldDef.encrypted,
        canOverride: true, // Can override with org-specific value
        hasEnvFallback: true,
      };
    } else if (fieldDef.default !== undefined) {
      // Use default from schema
      resolved.values[key] = fieldDef.default;
      resolved.metadata[key] = {
        value: fieldDef.default,
        source: "default",
        isEncrypted: false,
        canOverride: true,
      };
    } else {
      // No value available
      resolved.values[key] = undefined;
      resolved.metadata[key] = {
        value: undefined,
        source: "database",
        isEncrypted: false,
        canOverride: true,
      };
    }
  }

  return resolved;
}

/**
 * Resolve configuration for worker runtime (includes actual values)
 * This merges DB config, auth state credentials, and .env fallback
 */
export function resolveConfigForWorker(
  dbConfig: Record<string, unknown> | undefined,
  authState: { credentials?: Record<string, any> } | null | undefined,
  configSchema: Record<string, ConfigFieldDescriptor>,
): Record<string, any> {
  const resolved = resolveConfigWithEnv(dbConfig, configSchema, {
    decrypt: true,
    maskSecrets: false, // Worker needs real values
  });

  // Merge with auth credentials (from authState)
  if (authState?.credentials) {
    Object.assign(resolved.values, authState.credentials);
  }

  return resolved.values;
}

/**
 * Mask configuration for logging to prevent .env leakage
 */
export function maskConfigForLogging(
  config: Record<string, any>,
  schema: Record<string, ConfigFieldDescriptor>,
): Record<string, any> {
  const masked: Record<string, any> = {};
  for (const [key, value] of Object.entries(config)) {
    if (schema[key]?.encrypted || schema[key]?.env) {
      masked[key] = "********";
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
