import { PluginInstance } from "@server/entities/plugin-instance.entity";
import { decryptConfig } from "@server/lib/auth/utils/encryption";
import type { HayPluginManifest } from "@server/types/plugin.types";
import { oauthAuthStrategy } from "./oauth-auth-strategy.service";
import { PluginAPIService } from "./plugin-api/plugin-api.service";
import { config } from "@server/config/env";

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
      // Add plugin-specific env vars (legacy HAY_ prefix for backwards compatibility)
      HAY_ORGANIZATION_ID: organizationId,
      HAY_PLUGIN_NAME: instance.plugin.name,
      HAY_PLUGIN_VERSION: instance.plugin.version,
      HAY_PLUGIN_INSTANCE_ID: instance.id,
      // Standard env vars (no prefix) for Plugin API and modern plugins
      ORGANIZATION_ID: organizationId,
      PLUGIN_ID: instance.plugin.pluginId,
    };

    // Decrypt config values
    const decryptedConfig = instance.config ? decryptConfig(instance.config) : {};

    // Use metadata for SDK v2, fallback to manifest for legacy
    const configSchema = instance.plugin.metadata?.configSchema || manifest.configSchema;

    // Apply permitted environment variables
    for (const varName of permittedEnvVars) {
      // Check if it's defined in the config schema
      const configKey = this.findConfigKeyForEnvVar(varName, configSchema);

      if (configKey && decryptedConfig[configKey] !== undefined) {
        // Use value from database config (priority)
        env[varName] = String(decryptedConfig[configKey]);
      } else if (process.env[varName] !== undefined) {
        // Fall back to platform environment
        env[varName] = process.env[varName];
      }
    }

    // Add any additional environment variables from config that map to env
    if (configSchema) {
      for (const [key, schema] of Object.entries(configSchema)) {
        if (schema.env && decryptedConfig[key] !== undefined) {
          env[schema.env] = String(decryptedConfig[key]);
        }
      }
    }

    // Handle OAuth tokens for local MCP servers
    // For remote MCPs, tokens are passed as headers, not env vars
    const connectionType = manifest.capabilities?.mcp?.connection?.type || "local";
    if (connectionType === "local" && instance.authMethod === "oauth") {
      try {
        const tokens = await oauthAuthStrategy.getValidTokens(organizationId, instance.plugin.pluginId);
        if (tokens) {
          // Inject OAuth tokens as environment variables for local MCP servers
          // Standard OAuth token env vars
          env.OAUTH_ACCESS_TOKEN = tokens.access_token;
          if (tokens.refresh_token) {
            env.OAUTH_REFRESH_TOKEN = tokens.refresh_token;
          }
          if (tokens.token_type) {
            env.OAUTH_TOKEN_TYPE = tokens.token_type;
          }
          if (tokens.scope) {
            env.OAUTH_SCOPE = tokens.scope;
          }
        }
      } catch (error) {
        // Log but don't fail - plugin may handle missing tokens gracefully
        console.warn(`Failed to inject OAuth tokens for plugin ${instance.plugin.pluginId}:`, error);
      }
    }

    // Inject Plugin API credentials for HTTP-based callback access
    // This allows plugins running in separate processes to call back to the server
    // for privileged operations like sending emails
    if (connectionType === "local") {
      try {
        // Extract capabilities from manifest (permissions.api, not capabilities.api)
        const capabilities: string[] = manifest.permissions?.api || [];

        // Only inject credentials if plugin has API capabilities
        if (capabilities.length > 0) {
          // Generate JWT token for Plugin API access
          const pluginAPIService = PluginAPIService.getInstance();
          const apiToken = pluginAPIService.generateToken(
            instance.plugin.pluginId,
            organizationId,
            capabilities,
          );

          // Inject Plugin API credentials (URL and token only, IDs already set above)
          const serverUrl = `http://${config.server.host}:${config.server.port}`;
          // Use HAY_ prefix for consistency with Plugin SDK expectations
          // Include /v1 prefix so SDK paths like /plugin-api/... resolve correctly
          env.HAY_API_URL = `${serverUrl}/v1`;
          env.HAY_API_TOKEN = apiToken;

          console.log(
            `[EnvironmentManager] Injected Plugin API credentials for ${instance.plugin.name} (capabilities: ${capabilities.join(", ")})`,
          );
        }
      } catch (error) {
        console.warn(`Failed to inject Plugin API credentials for plugin ${instance.plugin.pluginId}:`, error);
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
