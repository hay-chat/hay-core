import { rateLimitService } from "./rate-limit.service";

/**
 * Abuse limits for the public webchat API (publicConversations.* and the
 * WebSocket). They are sized so a real shopper never meets them, and only
 * stop scripted floods. Counters live in Redis; if Redis is down the limits
 * fail open so the widget keeps working.
 *
 * Per-IP limits depend on the edge proxy setting X-Forwarded-For (see
 * lib/client-ip.ts), so each write is also limited per org or conversation.
 */
export const PUBLIC_WIDGET_LIMITS = {
  /** Longest customer message accepted, in characters (the widget caps input at 1000). */
  maxMessageLength: 4000,
  /** New conversations per IP. The widget creates one per open when storage is blocked. */
  createPerIp: { max: 30, windowSeconds: 10 * 60 },
  /** New conversations per organization, as a burst cap across all visitors. */
  createPerOrg: { max: 600, windowSeconds: 60 },
  /** Messages per conversation. */
  messagePerConversation: { max: 20, windowSeconds: 60 },
  /** Messages per IP, across conversations. */
  messagePerIp: { max: 60, windowSeconds: 60 },
} as const;

type LimitRule = Exclude<keyof typeof PUBLIC_WIDGET_LIMITS, "maxMessageLength">;

/**
 * Count one request against each rule and report whether any is exhausted.
 */
export async function isPublicWidgetRateLimited(
  checks: Array<{ rule: LimitRule; id: string }>,
): Promise<boolean> {
  const results = await Promise.all(
    checks.map(({ rule, id }) => {
      const { max, windowSeconds } = PUBLIC_WIDGET_LIMITS[rule];
      return rateLimitService.checkKeyRateLimit(`public-widget:${rule}:${id}`, max, windowSeconds);
    }),
  );
  return results.some((result) => result.limited);
}
