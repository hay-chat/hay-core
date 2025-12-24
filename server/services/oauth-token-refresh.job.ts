import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { oauthService } from "./oauth.service";
import { debugLog } from "@server/lib/debug-logger";
import { decryptConfig } from "../lib/auth/utils/encryption";
import type { OAuthTokenData, PluginConfigWithOAuth } from "../types/oauth.types";

/**
 * Background job to refresh OAuth tokens before they expire
 * Runs every 10 minutes and refreshes tokens expiring within 15 minutes
 */
export async function refreshOAuthTokens(): Promise<void> {
  try {
    // Get all plugin instances with OAuth auth_method
    const instances = await pluginInstanceRepository.findOAuthInstances();

    debugLog("oauth-refresh", `Checking ${instances.length} OAuth instances for token refresh`);

    const now = Math.floor(Date.now() / 1000);
    const refreshThreshold = 15 * 60; // 15 minutes in seconds

    for (const instance of instances) {
      try {
        if (!instance.config?._oauth) {
          continue;
        }

        const decryptedConfig = decryptConfig(instance.config) as PluginConfigWithOAuth;

        if (!decryptedConfig._oauth?.tokens?.expires_at) {
          continue; // No expiry info, skip
        }

        const oauthData = decryptedConfig._oauth;
        const expiresAt = oauthData.tokens.expires_at!; // Already checked above
        const timeUntilExpiry = expiresAt - now;

        // Refresh if expiring within threshold
        if (timeUntilExpiry > 0 && timeUntilExpiry < refreshThreshold) {
          debugLog("oauth-refresh", `Refreshing token for plugin ${instance.plugin.pluginId}`, {
            organizationId: instance.organizationId,
            expiresAt,
            timeUntilExpiry,
          });

          try {
            await oauthService.refreshToken(instance.organizationId, instance.plugin.pluginId);
            debugLog(
              "oauth-refresh",
              `Token refreshed successfully for plugin ${instance.plugin.pluginId}`,
            );
          } catch (error) {
            debugLog(
              "oauth-refresh",
              `Token refresh failed for plugin ${instance.plugin.pluginId}`,
              {
                level: "error",
                data: error instanceof Error ? error.message : String(error),
              },
            );

            // Mark connection as expired if refresh fails and token is already expired
            if (timeUntilExpiry <= 0) {
              debugLog(
                "oauth-refresh",
                `Marking connection as expired for plugin ${instance.plugin.pluginId}`,
              );
              // Could update instance status here if needed
            }
          }
        }
      } catch (error) {
        debugLog("oauth-refresh", `Error processing instance ${instance.id}`, {
          level: "error",
          data: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    debugLog("oauth-refresh", `OAuth token refresh job failed`, {
      level: "error",
      data: error instanceof Error ? error.message : String(error),
    });
  }
}
