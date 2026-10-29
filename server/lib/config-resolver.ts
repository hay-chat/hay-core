import type { ConfigFieldDescriptor } from "@server/types/plugin-sdk.types";
import { decryptConfig, decryptValue } from "@server/lib/auth/utils/encryption";

export interface ResolvedConfigField {
  value: unknown;
  source: "env" | "database" | "default";
  isEncrypted: boolean;
  /** The merchant may set their own value (false for a managed value when the policy forbids it). */
  canOverride: boolean;
  hasEnvFallback?: boolean; // Whether field has env variable fallback available
  /** The Hay server sets this value (its env var is set): "Managed by Hay.chat". */
  managed: boolean;
  /** Belongs on the Advanced tab: declared `advanced`, or managed. */
  advanced: boolean;
  /** Env var behind a managed-capable field; the dashboard shows it in Advanced mode only. */
  envName?: string;
}

/**
 * Whether a merchant may replace a value the server manages (D20, Roger's
 * answer 1). Off by default (Hay.chat cloud: managed values are read-only even
 * in Advanced mode); self-hosters turn it on with PLUGIN_ALLOW_MANAGED_OVERRIDE=true.
 */
export function isManagedOverrideAllowed(): boolean {
  return process.env.PLUGIN_ALLOW_MANAGED_OVERRIDE === "true";
}

function envValueOf(fieldDef: ConfigFieldDescriptor): string | undefined {
  const envVarName = fieldDef.env;
  return envVarName && process.env[envVarName] && process.env[envVarName] !== ""
    ? process.env[envVarName]
    : undefined;
}

/** Fields whose value the server manages right now (their env var is set). */
export function managedFieldKeys(configSchema: Record<string, ConfigFieldDescriptor>): string[] {
  return Object.entries(configSchema)
    .filter(([, fieldDef]) => envValueOf(fieldDef) !== undefined)
    .map(([key]) => key);
}

export interface ResolvedConfig {
  values: Record<string, unknown>;
  metadata: Record<string, ResolvedConfigField>;
}

/**
 * Enforce the managed-value policy on a configuration a merchant submits: when
 * overriding is not allowed, values for managed fields are dropped so the
 * server's value keeps applying (and a stored override is cleared on save).
 */
export function dropManagedOverrides(
  input: Record<string, unknown>,
  configSchema: Record<string, ConfigFieldDescriptor> | undefined,
): Record<string, unknown> {
  if (!configSchema || isManagedOverrideAllowed()) return input;
  const managed = new Set(managedFieldKeys(configSchema));
  return Object.fromEntries(Object.entries(input).filter(([key]) => !managed.has(key)));
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
    allowManagedOverride?: boolean; // Defaults to the PLUGIN_ALLOW_MANAGED_OVERRIDE policy
  } = {},
): ResolvedConfig {
  const {
    decrypt = false,
    maskSecrets = false,
    allowManagedOverride = isManagedOverrideAllowed(),
  } = options;

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
    const envValue = envValueOf(fieldDef);
    const managed = envValue !== undefined;
    const presentation = {
      managed,
      advanced: !!fieldDef.advanced || managed,
      ...(envVarName ? { envName: envVarName } : {}),
    };

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
        ...presentation,
      };
    } else if (hasEnvFallback && envValue !== undefined) {
      // Fallback to environment variable
      // For masked mode (frontend), don't expose any value - just indicate source via metadata
      resolved.values[key] = maskSecrets ? undefined : envValue;
      resolved.metadata[key] = {
        value: envValue,
        source: "env",
        isEncrypted: !!fieldDef.encrypted,
        canOverride: allowManagedOverride, // Org-specific value only when the policy allows it
        hasEnvFallback: true,
        ...presentation,
      };
    } else if (fieldDef.default !== undefined) {
      // Use default from schema
      resolved.values[key] = fieldDef.default;
      resolved.metadata[key] = {
        value: fieldDef.default,
        source: "default",
        isEncrypted: false,
        canOverride: true,
        ...presentation,
      };
    } else {
      // No value available
      resolved.values[key] = undefined;
      resolved.metadata[key] = {
        value: undefined,
        source: "database",
        isEncrypted: false,
        canOverride: true,
        ...presentation,
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
  authState: { credentials?: Record<string, unknown> } | null | undefined,
  configSchema: Record<string, ConfigFieldDescriptor>,
): Record<string, unknown> {
  const resolved = resolveConfigWithEnv(dbConfig, configSchema, {
    decrypt: true,
    maskSecrets: false, // Worker needs real values
  });
  resolved.values = stripServerOnlyFields(resolved.values, configSchema);

  // Merge with auth credentials (from authState)
  // Auth credentials are stored as encrypted strings — decrypt before merging
  if (authState?.credentials) {
    for (const [key, value] of Object.entries(authState.credentials)) {
      if (typeof value === "string") {
        try {
          resolved.values[key] = decryptValue(value);
        } catch {
          // If decryption fails, the value may not be encrypted — use as-is
          resolved.values[key] = value;
        }
      } else {
        resolved.values[key] = value;
      }
    }
  }

  return resolved.values;
}

/**
 * Drop config fields flagged `serverOnly` in the schema (e.g. OAuth client
 * secrets core uses for token exchange). Applied to every payload that leaves
 * core for a plugin worker: HAY_ORG_CONFIG, cron config and /on-connected.
 */
export function stripServerOnlyFields(
  config: Record<string, unknown>,
  schema: Record<string, ConfigFieldDescriptor>,
): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (schema[key]?.serverOnly) continue;
    stripped[key] = value;
  }
  return stripped;
}

/**
 * Mask configuration for logging to prevent .env leakage
 */
export function maskConfigForLogging(
  config: Record<string, unknown>,
  schema: Record<string, ConfigFieldDescriptor>,
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (schema[key]?.encrypted || schema[key]?.env) {
      masked[key] = "********";
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
