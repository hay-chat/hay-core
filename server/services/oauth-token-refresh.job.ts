import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { oauthService } from "./oauth.service";
import { createLogger } from "@server/lib/logger";
import { channelHealthService } from "./channel-health.service";

const logger = createLogger("oauth-refresh");

/**
 * Background job to refresh OAuth tokens before they expire.
 * Runs every 10 minutes and refreshes a token once 80% of its lifetime has
 * passed (a 60-day Instagram token at day 48), so a failed refresh or a
 * server outage still leaves many retries before it dies. Tokens stored
 * before `issuedAt` was recorded fall back to the last 15 minutes.
 *
 * If refreshing still fails within EXPIRY_WARNING of expiry, the instance is
 * marked `token_expiring` so owners and admins are asked to reconnect before
 * the token dies; the next successful refresh clears it.
 */

/** Share of a token's lifetime after which it is refreshed. */
export const REFRESH_AT_LIFETIME_SHARE = 0.8;
const FALLBACK_THRESHOLD_SECONDS = 15 * 60;
/** Warn owners and admins once a failing token has this little time left. */
export const EXPIRY_WARNING_SECONDS = 3 * 24 * 60 * 60;

/** True when a token with this expiry (and issue time, if known) should be refreshed now. */
export function shouldRefresh(
  expiresAt: number,
  issuedAt: number | undefined,
  now: number,
): boolean {
  if (expiresAt <= now) return false;
  if (issuedAt === undefined || issuedAt >= expiresAt) {
    return expiresAt - now < FALLBACK_THRESHOLD_SECONDS;
  }
  const refreshAt = issuedAt + (expiresAt - issuedAt) * REFRESH_AT_LIFETIME_SHARE;
  return now >= refreshAt || expiresAt - now < FALLBACK_THRESHOLD_SECONDS;
}
export async function refreshOAuthTokens(): Promise<void> {
  try {
    // Get all plugin instances with OAuth auth_method
    const instances = await pluginInstanceRepository.findOAuthInstances();

    logger.debug(`Checking ${instances.length} OAuth instances for token refresh`);

    const now = Math.floor(Date.now() / 1000);

    for (const instance of instances) {
      try {
        // Check authState for OAuth credentials. credentials is a
        // Record<string, unknown> (jsonb), so narrow expiresAt to a number
        // (epoch seconds) before using it in arithmetic.
        const rawExpiresAt = instance.authState?.credentials?.expiresAt;
        const expiresAt = typeof rawExpiresAt === "number" ? rawExpiresAt : undefined;
        const rawIssuedAt = instance.authState?.credentials?.issuedAt;
        const issuedAt = typeof rawIssuedAt === "number" ? rawIssuedAt : undefined;
        const hasRefreshToken = !!instance.authState?.credentials?.refreshToken;
        // Plugins can declare a custom refresh strategy (e.g. Instagram's
        // ig_refresh_token) that re-issues from the access token without a
        // refresh_token. Those must still be refreshed before expiry.
        const authMethods = (instance.plugin?.metadata?.authMethods ?? []) as Array<{
          type?: string;
          tokenRefresh?: unknown;
        }>;
        const hasCustomRefresh = authMethods.some((m) => m?.type === "oauth2" && !!m?.tokenRefresh);

        // Skip if no expiry info, or no way to refresh (neither a refresh token
        // nor a declared custom strategy).
        if (!expiresAt || (!hasRefreshToken && !hasCustomRefresh)) {
          continue;
        }

        const timeUntilExpiry = expiresAt - now;

        if (shouldRefresh(expiresAt, issuedAt, now)) {
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
            await channelHealthService.markOk(instance.organizationId, instance.plugin.pluginId, [
              "token_expiring",
            ]);
          } catch (error) {
            logger.error(
              { err: error },
              `Token refresh failed for plugin ${instance.plugin.pluginId}`,
            );
            if (timeUntilExpiry <= EXPIRY_WARNING_SECONDS) {
              await channelHealthService.markFailing(
                instance.organizationId,
                instance.plugin.pluginId,
                "token_expiring",
                new Date(expiresAt * 1000).toISOString(),
              );
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
