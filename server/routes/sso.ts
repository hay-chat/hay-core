import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authConfig } from "@server/config/auth.config";
import { getDashboardUrl } from "@server/config/env";
import { getClientIp } from "@server/lib/client-ip";
import { createLogger } from "@server/lib/logger";
import { auditLogService } from "@server/services/audit-log.service";
import { rateLimitService } from "@server/services/rate-limit.service";
import {
  SSO_BINDING_COOKIE,
  SsoLoginError,
  ssoService,
  type SsoFailureCode,
} from "@server/services/sso.service";

const logger = createLogger("sso-routes");
const router = Router();

const BINDING_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

function loginUrl(params: Record<string, string>): string {
  return `${getDashboardUrl()}/login?${new URLSearchParams(params).toString()}`;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim()) || undefined;
    }
  }
  return undefined;
}

/** Lax: the cookie must come back on the provider's redirect, which is a cross-site top-level GET. */
function bindingCookieOptions() {
  return {
    httpOnly: true,
    secure: authConfig.session.secure,
    sameSite: "lax" as const,
    path: "/sso",
  };
}

async function limited(req: Request, scope: "sso-start" | "sso-callback"): Promise<boolean> {
  const ip = getClientIp(req.headers, req.socket.remoteAddress) || "unknown";
  const result = await rateLimitService.checkIpRateLimit(ip, 30, 15 * 60, {
    scope,
    failClosed: true,
  });
  return result.limited;
}

/** Starts a sign-in: the browser arrives here, leaves for the provider and comes back to /sso/callback. */
router.get("/sso/start", async (req: Request, res: Response) => {
  const parsed = z.string().email().max(255).safeParse(req.query.email);
  if (!parsed.success) return res.redirect(loginUrl({ sso_error: "unavailable" }));
  try {
    if (await limited(req, "sso-start"))
      return res.redirect(loginUrl({ sso_error: "rate_limited" }));
    const { url, binding } = await ssoService.beginLogin(parsed.data);
    res.cookie(SSO_BINDING_COOKIE, binding, {
      ...bindingCookieOptions(),
      maxAge: BINDING_COOKIE_MAX_AGE_MS,
    });
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(url);
  } catch (error) {
    const code: SsoFailureCode = error instanceof SsoLoginError ? error.code : "provider_error";
    if (!(error instanceof SsoLoginError)) logger.error({ err: error }, "SSO start failed");
    return res.redirect(loginUrl({ sso_error: code }));
  }
});

router.get("/sso/callback", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const binding = readCookie(req, SSO_BINDING_COOKIE);
  res.clearCookie(SSO_BINDING_COOKIE, bindingCookieOptions());

  const params = z
    .object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(256) })
    .safeParse(req.query);
  if (!params.success) {
    // The provider reports its own refusals as `error`; its text is never shown.
    return res.redirect(
      loginUrl({ sso_error: req.query.error ? "provider_error" : "state_invalid" }),
    );
  }

  const request = {
    ipAddress: getClientIp(req.headers, req.socket.remoteAddress),
    userAgent: req.headers["user-agent"],
  };
  try {
    if (await limited(req, "sso-callback"))
      return res.redirect(loginUrl({ sso_error: "rate_limited" }));
    const ticket = await ssoService.handleCallback({ ...params.data, binding });
    return res.redirect(
      `${getDashboardUrl()}/sso/callback?${new URLSearchParams({ ticket }).toString()}`,
    );
  } catch (error) {
    if (error instanceof SsoLoginError) {
      await auditLogService.record({
        organizationId: error.organizationId,
        action: "sso.login_failed",
        resource: "auth",
        status: "failure",
        metadata: { reason: error.code },
        errorMessage: error.message,
        ...request,
      });
      return res.redirect(loginUrl({ sso_error: error.code }));
    }
    logger.error({ err: error }, "SSO callback failed");
    return res.redirect(loginUrl({ sso_error: "provider_error" }));
  }
});

export default router;
