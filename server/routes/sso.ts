import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { MAX_SAML_RESPONSE_CHARS } from "@server/lib/auth/sso/saml";
import { authConfig } from "@server/config/auth.config";
import { getApiUrl, getDashboardUrl } from "@server/config/env";
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

async function limited(
  req: Request,
  scope: "sso-start" | "sso-callback" | "sso-saml-acs" | "sso-saml-finish",
): Promise<boolean> {
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

  try {
    if (await limited(req, "sso-callback"))
      return res.redirect(loginUrl({ sso_error: "rate_limited" }));
    const ticket = await ssoService.handleCallback({ ...params.data, binding });
    return res.redirect(
      `${getDashboardUrl()}/sso/callback?${new URLSearchParams({ ticket }).toString()}`,
    );
  } catch (error) {
    return refuse(req, res, error);
  }
});

/** Records a refused sign-in and sends the browser back to the login page with a short code. */
async function refuse(req: Request, res: Response, error: unknown) {
  if (error instanceof SsoLoginError) {
    await auditLogService.record({
      organizationId: error.organizationId,
      action: "sso.login_failed",
      resource: "auth",
      status: "failure",
      metadata: { reason: error.code },
      errorMessage: error.message,
      ipAddress: getClientIp(req.headers, req.socket.remoteAddress),
      userAgent: req.headers["user-agent"],
    });
    return res.redirect(loginUrl({ sso_error: error.code }));
  }
  logger.error({ err: error }, "SSO callback failed");
  return res.redirect(loginUrl({ sso_error: "provider_error" }));
}

/**
 * Where the provider POSTs the SAML response. This request is cross-site, so
 * the Lax binding cookie is not sent with it; the response is verified here and
 * the browser is redirected (303, a same-site GET) to /sso/saml/finish, where
 * the cookie arrives and the sign-in is completed.
 */
router.post("/sso/saml/acs", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const body = z
    .object({
      SAMLResponse: z.string().min(1).max(MAX_SAML_RESPONSE_CHARS),
      RelayState: z.string().min(1).max(256),
    })
    .safeParse(req.body);
  // No RelayState means the provider started this sign-in, which is not supported.
  if (!req.is("application/x-www-form-urlencoded") || !body.success)
    return res.redirect(303, loginUrl({ sso_error: "state_invalid" }));
  try {
    if (await limited(req, "sso-saml-acs"))
      return res.redirect(303, loginUrl({ sso_error: "rate_limited" }));
    const handle = await ssoService.handleSamlResponse({
      samlResponse: body.data.SAMLResponse,
      relayState: body.data.RelayState,
    });
    return res.redirect(
      303,
      `${getApiUrl()}/sso/saml/finish?${new URLSearchParams({ handle }).toString()}`,
    );
  } catch (error) {
    return refuse(req, res, error);
  }
});

router.get("/sso/saml/finish", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const binding = readCookie(req, SSO_BINDING_COOKIE);
  res.clearCookie(SSO_BINDING_COOKIE, bindingCookieOptions());
  const handle = z.string().min(1).max(256).safeParse(req.query.handle);
  if (!handle.success) return res.redirect(loginUrl({ sso_error: "state_invalid" }));
  try {
    if (await limited(req, "sso-saml-finish"))
      return res.redirect(loginUrl({ sso_error: "rate_limited" }));
    const ticket = await ssoService.finishSamlLogin({ handle: handle.data, binding });
    return res.redirect(
      `${getDashboardUrl()}/sso/callback?${new URLSearchParams({ ticket }).toString()}`,
    );
  } catch (error) {
    return refuse(req, res, error);
  }
});

/** Service provider metadata, for owners who import it at their identity provider. */
router.get("/sso/saml/:organizationId/metadata", async (req: Request, res: Response) => {
  const organizationId = z.string().uuid().safeParse(req.params.organizationId);
  const metadata = organizationId.success
    ? await ssoService.samlMetadata(organizationId.data)
    : null;
  if (!metadata) return res.status(404).send("Not found");
  res.setHeader("Content-Type", "application/samlmetadata+xml; charset=utf-8");
  return res.send(metadata);
});

export default router;
