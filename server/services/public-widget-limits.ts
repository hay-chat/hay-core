import { rateLimitService } from "./rate-limit.service";

/**
 * Abuse limits for the public webchat API (publicConversations.* and the
 * WebSocket). They are sized so a real shopper never meets them, and only
 * stop scripted floods. Counters live in Redis. If Redis is down, requests
 * that create something lasting (conversations, stored files) are refused and
 * the rest count per process, so an open chat keeps working.
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
  /** Messages per organization, as a burst cap on AI runs across all visitors. */
  messagePerOrg: { max: 1200, windowSeconds: 60 },
  /** Messages per organization per hour: the ceiling on AI spend one site's traffic can cause. */
  messagePerOrgHourly: { max: 20000, windowSeconds: 60 * 60 },
  /** Message history reads per IP. */
  readPerIp: { max: 300, windowSeconds: 60 },
  /** Form submissions per IP. */
  formPerIp: { max: 30, windowSeconds: 60 },
  /** Key rotations per IP. A widget rotates rarely. */
  rotateKeysPerIp: { max: 30, windowSeconds: 10 * 60 },
  /** Files (photos, PDFs) per conversation. Each is up to 10 MB of storage. */
  attachmentPerConversation: { max: 10, windowSeconds: 10 * 60 },
  /** Challenge page loads per IP (one per first message; retries included). */
  challengePerIp: { max: 60, windowSeconds: 10 * 60 },
  /** Files per IP, across conversations. */
  attachmentPerIp: { max: 30, windowSeconds: 10 * 60 },
  /** Files per organization, as a burst cap on storage and vision cost across all visitors. */
  attachmentPerOrg: { max: 300, windowSeconds: 10 * 60 },
} as const;

type LimitRule = Exclude<keyof typeof PUBLIC_WIDGET_LIMITS, "maxMessageLength">;

/**
 * Count one request against the rules in order and report whether one is
 * exhausted.
 *
 * Rules run one at a time and stop at the first refusal, so a refused request
 * never spends the counters after it. Callers list the rule narrowest to the
 * caller first (per IP), then broader ones (per org, per conversation): a
 * flood from one IP then only burns its own counter and cannot exhaust a
 * merchant-wide or shopper-wide budget.
 */
export async function isPublicWidgetRateLimited(
  checks: Array<{ rule: LimitRule; id: string }>,
  options: { failClosed?: boolean } = {},
): Promise<boolean> {
  for (const { rule, id } of checks) {
    const { max, windowSeconds } = PUBLIC_WIDGET_LIMITS[rule];
    const result = await rateLimitService.checkKeyRateLimit(
      `public-widget:${rule}:${id}`,
      max,
      windowSeconds,
      options.failClosed ?? false,
    );
    if (result.limited) return true;
  }
  return false;
}
