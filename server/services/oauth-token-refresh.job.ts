import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { oauthService } from "./oauth.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("oauth-refresh");

/**
 * Background job to refresh OAuth tokens before they expire
 * Runs every 10 minutes and refreshes tokens expiring within 15 minutes
 */
export async function refreshOAuthTokens(): Promise<void> {
  try {
    // Get all plugin instances with OAuth auth_method
    const instances = await pluginInstanceRepository.findOAuthInstances();

    logger.debug(`Checking ${instances.length} OAuth instances for token refresh`);

    const now = Math.floor(Date.now() / 1000);
    const refreshThreshold = 15 * 60; // 15 minutes in seconds

    for (const instance of instances) {
      try {
        // Check authState for OAuth credentials
        const expiresAt = instance.authState?.credentials?.expiresAt;
        const hasRefreshToken = !!instance.authState?.credentials?.refreshToken;

        // Skip if no expiry info or no refresh token
        if (!expiresAt || !hasRefreshToken) {
          continue;
        }

        const timeUntilExpiry = expiresAt - now;

        // Refresh if expiring within threshold
        if (timeUntilExpiry > 0 && timeUntilExpiry < refreshThreshold) {
          logger.debug(
            {
              organizationId: instance.organizationId,
              expiresAt,
              timeUntilExpiry,
            },
            `Refreshing token for plugin ${instance.plugin.pluginId}`,
          );

          try {
            await oauthService.refreshToken(instance.organizationId, instance.plugin.pluginId);
            logger.debug(`Token refreshed successfully for plugin ${instance.plugin.pluginId}`);
          } catch (error) {
            logger.error(
              { err: error },
              `Token refresh failed for plugin ${instance.plugin.pluginId}`,
            );

            // Mark connection as expired if refresh fails and token is already expired
            if (timeUntilExpiry <= 0) {
              logger.debug(`Marking connection as expired for plugin ${instance.plugin.pluginId}`);
              // Could update instance status here if needed
            }
          }
        }
      } catch (error) {
        logger.error({ err: error }, `Error processing instance ${instance.id}`);
      }
    }
  } catch (error) {
    logger.error({ err: error }, `OAuth token refresh job failed`);
  }
}
