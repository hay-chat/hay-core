import type { PluginInstance } from "@server/entities/plugin-instance.entity";
import type { HayPluginManifest } from "@server/types/plugin.types";
import type { AuthStrategy } from "./auth-strategy.interface";
import { ApiKeyAuthStrategy } from "./api-key-auth-strategy";
import { OAuthAuthStrategy } from "./oauth-auth-strategy";

/**
 * Create an auth strategy for a plugin instance
 * Selects the appropriate strategy based on the authMethod
 */
export function createAuthStrategy(
  instance: PluginInstance,
  manifest: HayPluginManifest,
): AuthStrategy {
  // If authMethod is explicitly set, use it
  if (instance.authMethod === "oauth") {
    return new OAuthAuthStrategy(instance, manifest);
  }

  if (instance.authMethod === "api_key") {
    return new ApiKeyAuthStrategy(instance, manifest);
  }

  // Auto-detect based on config
  // Check if OAuth tokens exist in config
  if (instance.config && instance.config._oauth) {
    return new OAuthAuthStrategy(instance, manifest);
  }

  // Default to API key strategy
  return new ApiKeyAuthStrategy(instance, manifest);
}
