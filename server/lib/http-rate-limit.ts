import type { NextFunction, Request, Response } from "express";
import { rateLimitService } from "@server/services/rate-limit.service";

/**
 * Per-IP request ceilings for unauthenticated HTTP surfaces, checked before
 * any route runs. They are coarse caps on request volume from one address;
 * the finer per-procedure limits (public widget, auth) still apply on top.
 * While Redis is unavailable the counts are per process.
 */
const HTTP_IP_LIMITS: Array<{ prefix: string; bucket: string; max: number }> = [
  { prefix: "/v1/publicConversations", bucket: "public-conversations", max: 600 },
  // Includes provider webhooks (/v1/plugins/<id>/webhook), which arrive from a
  // few addresses in bursts; keep this high.
  { prefix: "/v1/plugins", bucket: "plugins", max: 3000 },
];
const WINDOW_SECONDS = 60;

/** How long clients should wait after a request refused because a dependency is down. */
const UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

/** tRPC response metadata: every 503 tells the client when to retry. */
export function trpcRetryAfterMeta({
  errors,
}: {
  errors: ReadonlyArray<{ code: string }>;
}): { headers: Record<string, string> } | Record<string, never> {
  return errors.some((error) => error.code === "SERVICE_UNAVAILABLE")
    ? { headers: { "Retry-After": String(UNAVAILABLE_RETRY_AFTER_SECONDS) } }
    : {};
}

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

  const result = await rateLimitService.checkKeyRateLimit(
    `http:${limit.bucket}:ip:${req.ip ?? "unknown"}`,
    limit.max,
    WINDOW_SECONDS,
  );
  if (result.limited) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
}
