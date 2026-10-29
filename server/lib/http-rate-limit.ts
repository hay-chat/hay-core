import type { NextFunction, Request, Response } from "express";
import { rateLimitService } from "@server/services/rate-limit.service";

/**
 * Per-IP request ceilings for unauthenticated HTTP surfaces, checked before
 * any route runs. They are coarse caps on request volume from one address;
 * the finer per-procedure limits (public widget, auth) still apply on top.
 * Fails open when Redis is unavailable, like the rest of the rate limiting.
 */
const HTTP_IP_LIMITS: Array<{ prefix: string; bucket: string; max: number }> = [
  { prefix: "/v1/publicConversations", bucket: "public-conversations", max: 600 },
  { prefix: "/v1/plugins", bucket: "plugins", max: 600 },
  // Providers deliver webhooks from a few addresses in bursts; keep this high.
  { prefix: "/plugins/webhooks", bucket: "plugin-webhooks", max: 3000 },
];
const WINDOW_SECONDS = 60;

export async function httpIpRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const limit =
    req.method === "OPTIONS"
      ? undefined
      : HTTP_IP_LIMITS.find(({ prefix }) => req.path.startsWith(prefix));
  if (!limit) {
    next();
    return;
  }

  let result: Awaited<ReturnType<typeof rateLimitService.checkKeyRateLimit>>;
  try {
    result = await rateLimitService.checkKeyRateLimit(
      `http:${limit.bucket}:ip:${req.ip ?? "unknown"}`,
      limit.max,
      WINDOW_SECONDS,
    );
  } catch {
    next();
    return;
  }
  if (result.limited) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
}
