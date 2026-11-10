/**
 * The public help center website.
 *
 * One Express middleware, mounted ahead of everything else. A request whose
 * Host is not a help center passes straight through to the API. A request on
 * a help center host is answered here and never reaches the API: besides the
 * handful of pages below, every path (`/v1/*`, `/uploads`, `/health`, ...) is
 * the 404 page, so a customer's site can never be used as a second door to
 * the dashboard's endpoints.
 *
 * Pages are server-rendered HTML that works without JavaScript. Content comes
 * only from services/help-center/public-content.ts, which owns the rule for
 * what is public.
 */
import crypto from "crypto";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod";
import { config, getApiUrl, getDashboardUrl, getWebSocketProtocol } from "@server/config/env";
import {
  DEFAULT_HELP_CENTER_THEME,
  type HelpCenter,
  type HelpCenterTheme,
} from "@server/database/entities/help-center.entity";
import { getClientIp } from "@server/lib/client-ip";
import { httpCompression } from "@server/lib/http-compression";
import { createLogger } from "@server/lib/logger";
import { organizationRepository } from "@server/repositories/organization.repository";
import { helpCenterThemeSchema } from "@server/routes/v1/help-center";
import { resolveTheme, verifyPreviewToken } from "@server/services/help-center/help-center.service";
import { resolveHelpCenterHost } from "@server/services/help-center/host-resolver";
import {
  getArticle,
  getCollection,
  listCollections,
  normalizeSearchQuery,
  recordArticleFeedback,
  searchArticles,
} from "@server/services/help-center/public-content";
import { renderArticleBody } from "@server/services/help-center/render/article-body";
import {
  FEEDBACK_PATH,
  PREVIEW_THEME_PARAM,
  PREVIEW_TOKEN_PARAM,
  renderArticlePage,
  renderCollectionPage,
  renderHomePage,
  renderNotFoundPage,
  renderSearchPage,
  siteHref,
  type SiteView,
} from "@server/services/help-center/render/pages";
import { buildRobotsTxt, buildSitemapXml } from "@server/services/help-center/render/seo";
import { SITE_CSS, SITE_CSS_PATH } from "@server/services/help-center/render/styles";
import {
  articlePath,
  collectionPath,
  id8,
  idRange,
  parseSlugId,
} from "@server/services/help-center/render/urls";
import { canonicalUrl } from "@server/services/help-center/urls";
import { rateLimitService } from "@server/services/rate-limit.service";
import { storageService } from "@server/services/storage.service";
import { webchatSettingsService } from "@server/services/webchat/webchat-settings.service";

const logger = createLogger("help-center-site");

/** Per IP, across every help center. Generous for a person, tight for a scraper. */
const SITE_REQUESTS_PER_MINUTE = 300;
/** Search scans article text, so it gets a smaller budget of its own. */
const SEARCH_REQUESTS_PER_MINUTE = 30;
const VOTE_WINDOW_SECONDS = 24 * 60 * 60;

const PAGE_CACHE = "public, max-age=60";
const NO_STORE = "no-store";
const PREVIEW_THEME_MAX_LENGTH = 2000;

const feedbackSchema = z.object({ articleId: z.string().max(36), helpful: z.boolean() });
const themePatchSchema = helpCenterThemeSchema.partial();

interface PolicyOptions {
  nonce: string;
  /** The chat widget is on the page: it loads from, talks to and frames the API host. */
  webchat: boolean;
  /** Who may frame the page: nobody, or the dashboard while previewing. */
  frameAncestors: string;
}

/** The pages' Content-Security-Policy. The global helmet does not run on help center hosts. */
export function contentSecurityPolicy({ nonce, webchat, frameAncestors }: PolicyOptions): string {
  const api = getApiUrl();
  const socket = `${getWebSocketProtocol()}://${config.domain.api}`;
  // Logos and signed document images come from the API host, plain http in development.
  const images = ["'self'", "data:", "https:"];
  if (!config.domain.useSSL) images.push(api);
  // The widget previews a picked image through a blob: URL.
  if (webchat) images.push("blob:");
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'${webchat ? ` ${api}` : ""}`,
    // The chat widget injects <style> elements it cannot put a nonce on.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images.join(" ")}`,
    `connect-src 'self'${webchat ? ` ${api} ${socket}` : ""}`,
    webchat ? `frame-src ${api}` : null,
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

/** The valid part of a stored or previewed theme; nothing when any of it is invalid. */
function themePatch(value: unknown): Partial<HelpCenterTheme> {
  const parsed = themePatchSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/** The theme a preview link carries (base64url JSON), or null when it is not a valid one. */
function decodePreviewTheme(param: string | null): Partial<HelpCenterTheme> | null {
  if (!param || param.length > PREVIEW_THEME_MAX_LENGTH) return null;
  try {
    const parsed = themePatchSchema.safeParse(
      JSON.parse(Buffer.from(param, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function isRateLimited(key: string, maxPerMinute: number): Promise<boolean> {
  // Not fail-closed: with Redis down the site stays up, counted per process.
  const result = await rateLimitService.checkKeyRateLimit(key, maxPerMinute, 60);
  return result.limited;
}

/** One answer per visitor address per article per day; the address itself is not kept. */
async function mayVote(helpCenterId: string, articleId: string, ip: string): Promise<boolean> {
  const voter = crypto
    .createHash("sha256")
    .update(`${helpCenterId}:${id8(articleId)}:${ip}`)
    .digest("hex");
  const result = await rateLimitService.checkKeyRateLimit(
    `help-center:vote:${voter}`,
    1,
    VOTE_WINDOW_SECONDS,
  );
  return !result.limited;
}

function setBaseHeaders(res: Response): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (config.domain.useSSL) {
    // Not includeSubDomains: on a custom domain that would reach hosts we do not serve.
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
}

function sendText(
  res: Response,
  status: number,
  contentType: string,
  body: string,
  cacheControl: string,
): void {
  res.status(status);
  res.setHeader("Content-Type", `${contentType}; charset=utf-8`);
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.send(body);
}

function sendPage(res: Response, status: number, view: SiteView, body: string): void {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", view.preview ? NO_STORE : PAGE_CACHE);
  res.setHeader(
    "Content-Security-Policy",
    contentSecurityPolicy({
      nonce: view.nonce,
      webchat: view.webchat !== null,
      frameAncestors: view.preview ? getDashboardUrl() : "'none'",
    }),
  );
  res.send(body);
}

/** The view of a host with nothing to show: no name, no branding, never indexed. */
function emptyView(nonce: string): SiteView {
  return {
    name: "",
    language: "en",
    canonicalBase: "",
    theme: DEFAULT_HELP_CENTER_THEME,
    logoUrl: null,
    noindex: true,
    nonce,
    preview: null,
    webchat: null,
  };
}

interface PreviewRequest {
  token: string;
  theme: string | null;
  themePatch: Partial<HelpCenterTheme>;
}

/** The request's preview, when it carries a valid token for this help center. */
function readPreview(req: Request, helpCenter: HelpCenter): PreviewRequest | null {
  const token = firstString(req.query[PREVIEW_TOKEN_PARAM]);
  if (!token || !verifyPreviewToken(helpCenter.id, token)) return null;
  const theme = firstString(req.query[PREVIEW_THEME_PARAM]);
  const patch = decodePreviewTheme(theme);
  return { token, theme: patch ? theme : null, themePatch: patch ?? {} };
}

/**
 * The site as this request may see it, or null when there is nothing to show:
 * the organization is gone or suspended, or the site is offline and this is
 * not a preview.
 */
async function loadSiteView(
  helpCenter: HelpCenter,
  preview: PreviewRequest | null,
  nonce: string,
): Promise<SiteView | null> {
  const [organization, webchatEnabled] = await Promise.all([
    organizationRepository.findById(helpCenter.organizationId),
    webchatSettingsService.isEnabled(helpCenter.organizationId),
  ]);
  if (!organization || organization.suspendedAt) return null;
  if (!helpCenter.isPublished && !preview) return null;
  return {
    name: helpCenter.name,
    language: helpCenter.defaultLanguage,
    canonicalBase: canonicalUrl(helpCenter),
    theme: resolveTheme({ ...themePatch(helpCenter.theme), ...preview?.themePatch }),
    logoUrl: organization.logoUpload ? storageService.getUrl(organization.logoUpload) : null,
    noindex: !helpCenter.searchIndexing || preview !== null,
    nonce,
    preview: preview ? { token: preview.token, theme: preview.theme } : null,
    webchat: webchatEnabled
      ? { organizationId: helpCenter.organizationId, baseUrl: getApiUrl() }
      : null,
  };
}

/** A renamed article or collection keeps its old addresses: they move to the current one. */
function redirectToCurrent(res: Response, view: SiteView, path: string): void {
  res.setHeader("Cache-Control", view.preview ? NO_STORE : PAGE_CACHE);
  res.redirect(view.preview ? 302 : 301, siteHref(view, path));
}

async function handleFeedback(
  req: Request,
  res: Response,
  helpCenter: HelpCenter,
  ip: string,
  parseJson: RequestHandler,
): Promise<void> {
  // Always 204: the answer tells a visitor nothing about what exists.
  res.setHeader("Cache-Control", NO_STORE);
  const parsedBody = await new Promise<boolean>((resolve) =>
    parseJson(req, res, (error?: unknown) => resolve(!error)),
  );
  const feedback = parsedBody ? feedbackSchema.safeParse(req.body) : null;
  if (feedback?.success && idRange(feedback.data.articleId)) {
    const { articleId, helpful } = feedback.data;
    // Offline sites take no answers; a preview never sends any.
    const view = await loadSiteView(helpCenter, null, "");
    if (view && (await mayVote(helpCenter.id, articleId, ip))) {
      await recordArticleFeedback(helpCenter, articleId, helpful);
    }
  }
  res.status(204).end();
}

async function handleSite(
  req: Request,
  res: Response,
  helpCenter: HelpCenter,
  ip: string,
  nonce: string,
): Promise<void> {
  const preview = readPreview(req, helpCenter);
  // Started now so it runs alongside the page's content query.
  const loadingView = loadSiteView(helpCenter, preview, nonce);
  const notFound = (view: SiteView | null) =>
    sendPage(res, 404, view ?? emptyView(nonce), renderNotFoundPage(view ?? emptyView(nonce)));
  const path = req.path;

  if (path === "/robots.txt") {
    const live = (await loadingView) && helpCenter.isPublished && helpCenter.searchIndexing;
    return sendText(
      res,
      200,
      "text/plain",
      buildRobotsTxt(live ? canonicalUrl(helpCenter) : null),
      PAGE_CACHE,
    );
  }

  if (path === "/sitemap.xml") {
    const [view, collections] = await Promise.all([loadingView, listCollections(helpCenter)]);
    if (!view || !helpCenter.searchIndexing) return notFound(view);
    return sendText(
      res,
      200,
      "application/xml",
      buildSitemapXml(view.canonicalBase, collections),
      view.preview ? NO_STORE : PAGE_CACHE,
    );
  }

  if (path === "/") {
    const [view, collections] = await Promise.all([loadingView, listCollections(helpCenter)]);
    if (!view) return notFound(view);
    return sendPage(res, 200, view, renderHomePage(view, collections));
  }

  if (path === "/search") {
    if (await isRateLimited(`help-center:search:ip:${ip}`, SEARCH_REQUESTS_PER_MINUTE)) {
      return sendText(res, 429, "text/plain", "Too many requests", NO_STORE);
    }
    const query = normalizeSearchQuery(firstString(req.query.q));
    const [view, results] = await Promise.all([loadingView, searchArticles(helpCenter, query)]);
    if (!view) return notFound(view);
    return sendPage(res, 200, view, renderSearchPage(view, query, results));
  }

  const [, section, segment, ...rest] = path.split("/");
  const pageId8 = rest.length === 0 && segment ? parseSlugId(segment) : null;

  if (section === "collections" && pageId8) {
    const [view, collection] = await Promise.all([loadingView, getCollection(helpCenter, pageId8)]);
    if (!view || !collection) return notFound(view);
    const current = collectionPath(collection);
    if (path !== current) return redirectToCurrent(res, view, current);
    return sendPage(res, 200, view, renderCollectionPage(view, collection));
  }

  if (section === "articles" && pageId8) {
    const [view, article] = await Promise.all([loadingView, getArticle(helpCenter, pageId8)]);
    if (!view || !article) return notFound(view);
    const current = articlePath(article);
    if (path !== current) return redirectToCurrent(res, view, current);
    const body = await renderArticleBody(article, helpCenter.organizationId, (target) =>
      siteHref(view, target),
    );
    return sendPage(res, 200, view, renderArticlePage(view, article, body));
  }

  return notFound(await loadingView);
}

async function handle(
  req: Request,
  res: Response,
  next: NextFunction,
  middleware: { compress: RequestHandler; parseJson: RequestHandler },
): Promise<void> {
  const match = await resolveHelpCenterHost(req.hostname ?? "");
  if (match.kind === "none") return next();

  // From here on the request is ours: it is answered below and never reaches the API.
  try {
    setBaseHeaders(res);
    await new Promise<void>((resolve) => middleware.compress(req, res, () => resolve()));

    const ip = getClientIp(req.headers, req.socket.remoteAddress);
    if (await isRateLimited(`help-center:site:ip:${ip}`, SITE_REQUESTS_PER_MINUTE)) {
      res.setHeader("Retry-After", "60");
      return sendText(res, 429, "text/plain", "Too many requests", NO_STORE);
    }

    const isRead = req.method === "GET" || req.method === "HEAD";
    const isFeedback = req.method === "POST" && req.path === FEEDBACK_PATH;
    if (!isRead && !isFeedback) {
      res.setHeader("Allow", req.path === FEEDBACK_PATH ? "POST" : "GET, HEAD");
      return sendText(res, 405, "text/plain", "Method not allowed", NO_STORE);
    }

    if (isRead && req.path === SITE_CSS_PATH) {
      return sendText(res, 200, "text/css", SITE_CSS, "public, max-age=31536000, immutable");
    }

    if (match.kind === "unknown") {
      if (isFeedback) {
        res.status(204).end();
        return;
      }
      if (req.path === "/robots.txt") {
        return sendText(res, 200, "text/plain", buildRobotsTxt(null), PAGE_CACHE);
      }
      const view = emptyView(crypto.randomBytes(16).toString("base64"));
      return sendPage(res, 404, view, renderNotFoundPage(view));
    }

    if (isFeedback) {
      return await handleFeedback(req, res, match.helpCenter, ip, middleware.parseJson);
    }
    const nonce = crypto.randomBytes(16).toString("base64");
    await handleSite(req, res, match.helpCenter, ip, nonce);
  } catch (error) {
    logger.error({ err: error }, "Failed to serve a help center page");
    if (res.headersSent) {
      res.end();
      return;
    }
    sendText(res, 500, "text/plain", "Something went wrong", NO_STORE);
  }
}

/** Serves help center hosts; every other request continues to the API untouched. */
export function helpCenterSite(): RequestHandler {
  const middleware = {
    compress: httpCompression(),
    // The only body the site reads is a feedback answer.
    parseJson: express.json({ limit: "1kb" }),
  };
  return (req, res, next) => {
    handle(req, res, next, middleware).catch(next);
  };
}

/**
 * GET /internal/help-center/tls-ask?domain=<host>
 *
 * Asked by the reverse proxy (Caddy on-demand TLS) before it obtains a
 * certificate for a hostname: 200 when that hostname serves a help center,
 * 404 otherwise. No authentication, as the answer only says whether a host is
 * served, but reverse proxies must not expose `/internal/*` to the internet.
 */
export async function helpCenterTlsAskHandler(req: Request, res: Response): Promise<void> {
  const domain = firstString(req.query.domain) ?? "";
  const served =
    domain.length > 0 &&
    domain.length <= 253 &&
    (await resolveHelpCenterHost(domain)).kind === "site";
  res.setHeader("Cache-Control", NO_STORE);
  res.status(served ? 200 : 404).end();
}
