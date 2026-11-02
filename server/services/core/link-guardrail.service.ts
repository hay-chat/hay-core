import dns from "dns/promises";
import { createLogger } from "@server/lib/logger";
import { validateUrlForSSRF } from "@server/utils/ssrf";

const logger = createLogger("link-guardrail");

/**
 * Link guardrail: catches made-up URLs in AI replies without asking an LLM.
 *
 * A URL that appears in the conversation context (a document's Source line,
 * a tool result, the customer's own message) or in the organization's site
 * index is trusted and never fetched. Any other URL gets a cheap liveness
 * request. Only clear failures count as dead (404/410, unknown host, a
 * redirect to the site's home page); 401/403/429/5xx and timeouts are
 * "unknown" and pass, because many sites block automated requests.
 *
 * A live URL on the organization's own site that is missing from a non-empty
 * site index is "unlisted": probably invented (sites often answer 200 for
 * missing pages), so it earns a re-plan, but it is not proof of a wrong link.
 */

export type LinkStatus = "live" | "dead" | "unknown";

export interface BadLink {
  url: string;
  /** dead: the link does not work. unlisted: own-site page not in the site index. */
  reason: "dead" | "unlisted";
}

export interface LinkAssessmentInput {
  response: string;
  /** Text the reply may legitimately quote URLs from (messages, docs, tool results). */
  contextTexts: string[];
  /** URLs from the organization's site index (sitemap). */
  siteUrls?: string[];
  /** The organization's website, if set. */
  website?: string | null;
}

const REQUEST_TIMEOUT_MS = 3000;
const MAX_REDIRECTS = 3;
const MAX_URLS_CHECKED = 10;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;

// Markdown link target, or a bare http(s) URL.
const MARKDOWN_LINK = /\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/gi;
// Backslash too: tool outputs are matched as JSON text, where quotes are escaped.
const BARE_URL = /https?:\/\/[^\s<>"'`)\]\\]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?*_~]+$/;

/** Every http(s) URL in the text, in order, without duplicates. */
export function extractUrls(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    found.add(match[1].replace(TRAILING_PUNCTUATION, ""));
  }
  for (const match of text.matchAll(BARE_URL)) {
    found.add(match[0].replace(TRAILING_PUNCTUATION, ""));
  }
  return [...found].filter((url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  });
}

export function hostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/** Comparison key: host without www, no fragment, no trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${hostKey(parsed.hostname)}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

export function websiteUrl(website?: string | null): URL | null {
  if (!website) return null;
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  } catch {
    return null;
  }
}

const statusCache = new Map<string, { status: LinkStatus; expiresAt: number }>();

function cacheGet(url: string): LinkStatus | null {
  const entry = statusCache.get(url);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    statusCache.delete(url);
    return null;
  }
  return entry.status;
}

function cacheSet(url: string, status: LinkStatus): void {
  if (statusCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = statusCache.keys().next().value;
    if (oldest) statusCache.delete(oldest);
  }
  statusCache.set(url, { status, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Test hook. */
export function clearLinkStatusCache(): void {
  statusCache.clear();
}

async function request(url: string, method: "HEAD" | "GET"): Promise<Response> {
  return fetch(url, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HayLinkCheck/1.0; +https://hay.chat)",
      ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
    },
  });
}

function isRootPath(url: URL): boolean {
  return url.pathname.replace(/\/+$/, "") === "";
}

/**
 * Fetch the URL (HEAD, GET when HEAD is refused), following redirects by hand
 * so every hop goes through the SSRF check.
 */
export async function checkLink(url: string): Promise<LinkStatus> {
  const cached = cacheGet(url);
  if (cached) return cached;

  const status = await checkLinkUncached(url);
  cacheSet(url, status);
  return status;
}

async function checkLinkUncached(url: string): Promise<LinkStatus> {
  const original = new URL(url);
  let current = original;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await dns.lookup(current.hostname);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOTFOUND" ? "dead" : "unknown";
    }

    try {
      await validateUrlForSSRF(current.href);
    } catch {
      // A reply should never point customers at an internal address.
      return "dead";
    }

    let response: Response;
    try {
      response = await request(current.href, "HEAD");
      if (response.status === 405 || response.status === 501) {
        response = await request(current.href, "GET");
      }
    } catch {
      return "unknown";
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return "unknown";
      const next = new URL(location, current);
      // A deep link that lands on the home page is the usual "page not found".
      if (
        !isRootPath(original) &&
        isRootPath(next) &&
        hostKey(next.hostname) === hostKey(original.hostname)
      ) {
        return "dead";
      }
      current = next;
      continue;
    }

    if (response.status === 404 || response.status === 410) return "dead";
    if (response.status >= 200 && response.status < 300) return "live";
    return "unknown";
  }

  return "unknown";
}

export class LinkGuardrailService {
  constructor(private readonly check: (url: string) => Promise<LinkStatus> = checkLink) {}

  async assessLinks(input: LinkAssessmentInput): Promise<BadLink[]> {
    const urls = extractUrls(input.response);
    if (urls.length === 0) return [];

    const known = new Set<string>();
    for (const text of input.contextTexts) {
      for (const url of extractUrls(text)) known.add(normalizeUrl(url));
    }
    const siteIndex = new Set((input.siteUrls ?? []).map(normalizeUrl));
    const website = websiteUrl(input.website);
    const ownHost = website ? hostKey(website.hostname) : null;
    if (website) known.add(normalizeUrl(website.href));

    const unverified = urls
      .filter((url) => {
        const key = normalizeUrl(url);
        return !known.has(key) && !siteIndex.has(key);
      })
      .slice(0, MAX_URLS_CHECKED);

    const results = await Promise.all(
      unverified.map(async (url): Promise<BadLink | null> => {
        const status = await this.check(url).catch(() => "unknown" as const);
        if (status === "dead") return { url, reason: "dead" };
        const isOwnSite = ownHost !== null && hostKey(new URL(url).hostname) === ownHost;
        if (isOwnSite && siteIndex.size > 0) return { url, reason: "unlisted" };
        return null;
      }),
    );

    const badLinks = results.filter((link): link is BadLink => link !== null);
    if (badLinks.length > 0) {
      logger.debug({ badLinks, checked: unverified.length }, "Reply has bad links");
    }
    return badLinks;
  }
}
