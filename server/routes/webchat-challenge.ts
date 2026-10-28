/**
 * Hay.chat-hosted challenge frame (D9-8).
 *
 * GET /v1/webchat/challenge?org=<uuid>&c=<contribution id>&origin=<page origin>
 *
 * The widget runs on the merchant's page, but the challenge provider's widget
 * is rendered here, inside an iframe served from the Hay.chat API host. That
 * means:
 *  - one Hay.chat-owned site key works for every store: the provider sees (and
 *    Siteverify reports) the API hostname, not each merchant's domain;
 *  - the merchant page only needs to allow framing the Hay.chat API host, not
 *    the provider's scripts.
 *
 * The page posts its result to the parent with `targetOrigin` set to the
 * validated page origin, and CSP `frame-ancestors` limits who may embed it to
 * that same origin. The origin must be on the org's allowed domains (or be the
 * Hay.chat dashboard), exactly like publicConversations.create.
 */

import crypto from "crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "@server/lib/logger";
import { getClientIp } from "@server/lib/client-ip";
import { isDashboardHost } from "@server/lib/webchat-origin";
import { organizationRepository } from "@server/repositories/organization.repository";
import { webchatSettingsService } from "@server/services/webchat/webchat-settings.service";
import { webchatExtensionsService } from "@server/services/webchat/webchat-extensions.service";
import { isUnderAttack } from "@server/services/webchat/under-attack.service";
import { isPublicWidgetRateLimited } from "@server/services/public-widget-limits";

const logger = createLogger("webchat-challenge");

/** Message source tag the widget checks on every postMessage. */
export const CHALLENGE_MESSAGE_SOURCE = "hay-challenge";

/** Where each provider's script and frames are served from. */
const PROVIDER_ORIGINS: Record<string, string> = {
  turnstile: "https://challenges.cloudflare.com",
};

const querySchema = z.object({
  org: z.string().uuid(),
  c: z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/),
  origin: z.string().max(300),
  lang: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})?$/)
    .optional(),
});

/**
 * Normalise a page origin: scheme + host + port only, http(s) only.
 * Returns null for anything else (paths, credentials, other schemes, "null").
 */
export function parsePageOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.origin !== value) return null;
    return url;
  } catch {
    return null;
  }
}

/** JSON safe to embed inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

interface ChallengePageOptions {
  nonce: string;
  provider: string;
  siteKey: string;
  action: string;
  appearance: "interaction-only" | "always";
  parentOrigin: string;
  language: string;
}

/** The challenge page HTML. Exported for tests. */
export function renderChallengePage(options: ChallengePageOptions): string {
  const providerOrigin = PROVIDER_ORIGINS[options.provider];
  const settings = scriptJson({
    source: CHALLENGE_MESSAGE_SOURCE,
    siteKey: options.siteKey,
    action: options.action,
    appearance: options.appearance,
    parentOrigin: options.parentOrigin,
    language: options.language,
  });
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<style nonce="${options.nonce}">html,body{margin:0;padding:0;background:transparent}#c{display:flex;justify-content:center;padding:4px}</style>
</head><body><div id="c"></div>
<script nonce="${options.nonce}">
(function () {
  var s = ${settings};
  function post(msg) {
    msg.source = s.source;
    window.parent.postMessage(msg, s.parentOrigin);
  }
  window.onHayChallengeLoad = function () {
    try {
      window.turnstile.render("#c", {
        sitekey: s.siteKey,
        action: s.action,
        appearance: s.appearance,
        language: s.language,
        theme: "auto",
        "refresh-expired": "never",
        callback: function (token) { post({ type: "token", token: token }); },
        "error-callback": function (code) { post({ type: "error", code: String(code || "error") }); return true; },
        "expired-callback": function () { post({ type: "expired" }); },
        "timeout-callback": function () { post({ type: "error", code: "timeout" }); },
        "before-interactive-callback": function () { post({ type: "interactive" }); },
        "unsupported-callback": function () { post({ type: "error", code: "unsupported" }); }
      });
      if (s.appearance === "always") post({ type: "interactive" });
    } catch (e) {
      post({ type: "error", code: "render_failed" });
    }
  };
  post({ type: "ready" });
})();
</script>
<script nonce="${options.nonce}" src="${providerOrigin}/turnstile/v0/api.js?render=explicit&onload=onHayChallengeLoad" async defer></script>
</body></html>`;
}

function contentSecurityPolicy(nonce: string, providerOrigin: string, frameAncestor: string) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${providerOrigin}`,
    `style-src 'nonce-${nonce}'`,
    `frame-src ${providerOrigin}`,
    `connect-src ${providerOrigin}`,
    `frame-ancestors ${frameAncestor}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function refuse(res: Response, status: number, reason: string): void {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.send(reason);
}

export async function webchatChallengeHandler(req: Request, res: Response): Promise<void> {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return refuse(res, 400, "Bad request");
    const { org, c, origin, lang } = parsed.data;

    const pageOrigin = parsePageOrigin(origin);
    if (!pageOrigin) return refuse(res, 400, "Bad origin");

    if (
      await isPublicWidgetRateLimited([
        { rule: "challengePerIp", id: getClientIp(req.headers, req.socket.remoteAddress) },
      ])
    ) {
      return refuse(res, 429, "Too many requests");
    }

    const [isEnabled, organization] = await Promise.all([
      webchatSettingsService.isEnabled(org),
      organizationRepository.findById(org),
    ]);
    if (!isEnabled || !organization || organization.suspendedAt) {
      return refuse(res, 404, "Not available");
    }

    const hostname = pageOrigin.hostname.toLowerCase();
    if (!isDashboardHost(hostname) && !(await webchatSettingsService.isDomainAllowed(org, hostname))) {
      return refuse(res, 403, "This website is not allowed to use this chat");
    }

    const challenge = (
      await webchatExtensionsService.resolveChallenges(org, { underAttack: await isUnderAttack(org) })
    ).find(
      (candidate) => candidate.id === c,
    );
    const providerOrigin = challenge && PROVIDER_ORIGINS[challenge.props.provider];
    if (!challenge || !providerOrigin) return refuse(res, 404, "Not available");

    const nonce = crypto.randomBytes(16).toString("base64");
    res.status(200);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      contentSecurityPolicy(nonce, providerOrigin, pageOrigin.origin),
    );
    res.send(
      renderChallengePage({
        nonce,
        provider: challenge.props.provider,
        siteKey: challenge.props.siteKey,
        action: challenge.props.action,
        appearance: challenge.props.mode === "challenge_all" ? "always" : "interaction-only",
        parentOrigin: pageOrigin.origin,
        language: lang ?? "auto",
      }),
    );
  } catch (error) {
    logger.error({ err: error }, "Failed to serve the webchat challenge page");
    refuse(res, 500, "Error");
  }
}
