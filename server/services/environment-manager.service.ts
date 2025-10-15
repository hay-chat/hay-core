import { PluginInstance } from "@server/entities/plugin-instance.entity";
import { decryptConfig } from "@server/lib/auth/utils/encryption";
import type { HayPluginManifest } from "@server/types/plugin.types";

// Type for config schema
type ConfigSchema = NonNullable<HayPluginManifest["configSchema"]>;

export class EnvironmentManagerService {
  /**
   * Prepare environment variables for a plugin instance
   * Merges platform env, database config, and applies permissions
   */
  async prepareEnvironment(
    organizationId: string,
    instance: PluginInstance,
  ): Promise<NodeJS.ProcessEnv> {
    const manifest = instance.plugin.manifest as HayPluginManifest;
    const permittedEnvVars = manifest.permissions?.env || [];

    // Start with a clean environment
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV || "production",
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      // Add plugin-specific env vars
      HAY_ORGANIZATION_ID: organizationId,
      HAY_PLUGIN_NAME: instance.plugin.name,
      HAY_PLUGIN_VERSION: instance.plugin.version,
      HAY_PLUGIN_INSTANCE_ID: instance.id,
    };

    // Decrypt config values
    const decryptedConfig = instance.config ? decryptConfig(instance.config) : {};

    // Apply permitted environment variables
    for (const varName of permittedEnvVars) {
      // Check if it's defined in the config schema
      const configKey = this.findConfigKeyForEnvVar(varName, manifest.configSchema);

      if (configKey && decryptedConfig[configKey] !== undefined) {
        // Use value from database config (priority)
        env[varName] = String(decryptedConfig[configKey]);
      } else if (process.env[varName] !== undefined) {
        // Fall back to platform environment
        env[varName] = process.env[varName];
      }
    }

    // Add any additional environment variables from config that map to env
    if (manifest.configSchema) {
      for (const [key, schema] of Object.entries(manifest.configSchema)) {
        if (schema.env && decryptedConfig[key] !== undefined) {
          env[schema.env] = String(decryptedConfig[key]);
        }
      }
    }

    return env;
  }

  /**
   * Find config key that maps to an environment variable
   */
  private findConfigKeyForEnvVar(envVar: string, configSchema?: ConfigSchema): string | undefined {
    if (!configSchema) return undefined;

    for (const [key, schema] of Object.entries(configSchema)) {
      if (schema.env === envVar) {
        return key;
      }
    }

    return undefined;
  }

  /**
   * Validate that all required environment variables are present
   */
  validateEnvironment(
    env: NodeJS.ProcessEnv,
    manifest: HayPluginManifest,
  ): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    if (manifest.configSchema) {
      for (const [_key, schema] of Object.entries(manifest.configSchema)) {
        if (schema.required && schema.env) {
          if (!env[schema.env]) {
            missing.push(schema.env);
          }
        }
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * Sanitize environment variables for logging
   * Masks sensitive values
   */
  sanitizeForLogging(env: NodeJS.ProcessEnv, manifest: HayPluginManifest): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (!value) continue;

      // Check if this env var is marked as encrypted in config schema
      const isEncrypted = Object.values(manifest.configSchema || {}).some(
        (schema) => schema.env === key && schema.encrypted,
      );

      if (isEncrypted) {
        // Mask sensitive values
        sanitized[key] = value.substring(0, 4) + "****";
      } else if (
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("key")
      ) {
        // Also mask common sensitive patterns
        sanitized[key] = "****";
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Create isolated environment for plugin sandbox
   */
  createSandboxEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    // Create a copy to avoid modifying the original
    const sandboxEnv = { ...baseEnv };

    // Remove potentially dangerous environment variables
    const dangerousVars = [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "GITHUB_TOKEN",
      "NPM_TOKEN",
      "DATABASE_URL",
      "JWT_SECRET",
      "PLUGIN_ENCRYPTION_KEY",
    ];

    for (const varName of dangerousVars) {
      if (!baseEnv[varName]) {
        delete sandboxEnv[varName];
      }
    }

    return sandboxEnv;
  }
}

export const environmentManagerService = new EnvironmentManagerService();
