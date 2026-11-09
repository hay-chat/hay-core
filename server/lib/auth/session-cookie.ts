import type { NextFunction, Request, Response } from "express";
import { authConfig } from "@server/config/auth.config";
import { config } from "@server/config/env";

/**
 * The dashboard's refresh token lives in an HttpOnly cookie, out of reach of
 * page scripts. Cookie paths match on `/` boundaries, so `/v1/auth` would not
 * match `/v1/auth.refreshToken`: one cookie per endpoint that needs it.
 */
const COOKIE_PATHS = ["/v1/auth.refreshToken", "/v1/auth.logout"];

function cookieOptions(path: string) {
  const { secure, httpOnly, sameSite } = authConfig.session;
  return { secure, httpOnly, sameSite, path };
}

export function setRefreshCookies(res: Response, refreshToken: string): void {
  for (const path of COOKIE_PATHS) {
    res.cookie(authConfig.session.cookieName, refreshToken, {
      ...cookieOptions(path),
      maxAge: authConfig.session.absoluteLifetimeMs,
    });
  }
}

export function clearRefreshCookies(res: Response): void {
  for (const path of COOKIE_PATHS) {
    res.clearCookie(authConfig.session.cookieName, cookieOptions(path));
  }
}

function isDashboardOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  const allowed = config.cors.origin;
  return Array.isArray(allowed) ? allowed.includes(origin) : allowed === origin;
}

/**
 * The refresh token from the cookie, for requests sent by the dashboard.
 * Browsers always send Origin on these POSTs; requiring a known one keeps the
 * cookie unusable from other sites even under a relaxed SameSite setting.
 */
export function readRefreshCookie(req: Request): string | undefined {
  if (!isDashboardOrigin(req.headers.origin)) return undefined;
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== authConfig.session.cookieName) continue;
    return decodeURIComponent(part.slice(separator + 1).trim()) || undefined;
  }
  return undefined;
}

/** Auth responses carry credentials and must never be stored by a cache. */
export function noStoreOnAuthRoutes(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/auth.")) res.setHeader("Cache-Control", "no-store");
  next();
}
