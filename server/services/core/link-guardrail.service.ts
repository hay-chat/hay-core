import dns from "dns/promises";
import { createLogger } from "@server/lib/logger";
import { safeFetch, validateUrlForSSRF } from "@server/utils/ssrf";

const logger = createLogger("link-guardrail");

/**
 * Link guardrail: catches made-up URLs in AI replies without asking an LLM.
 *
 * A URL that appears in the conversation context (a document's Source line,
 * a tool result, the customer's own message) or in the organization's site
 * index is trusted and never fetched. A URL on any other host is "unverified"
 * and is never requested: whatever the model put in it would reach that host.
 *
 * A URL on the organization's own site gets a cheap liveness request. Only
 * clear failures count as dead (404/410, unknown host, a redirect to the
 * site's home page); 401/403/429/5xx and timeouts are "unknown" and pass,
 * because many sites block automated requests. A live own-site URL missing
 * from a non-empty site index is "unlisted": probably invented (sites often
 * answer 200 for missing pages), so it earns a re-plan.
 */

export type LinkStatus = "live" | "dead" | "unknown";

export interface BadLink {
  url: string;
  /**
   * dead: the link does not work. unlisted: own-site page not in the site index.
   * unverified: another host's URL that nothing in the conversation vouches for.
   */
  reason: "dead" | "unlisted" | "unverified";
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

/** True when `hostname` is the organization's host or one of its subdomains. */
export function isOwnHost(hostname: string, ownHost: string): boolean {
  const host = hostKey(hostname);
  return host === ownHost || host.endsWith(`.${ownHost}`);
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
  return safeFetch(url, {
    method,
    timeoutMs: REQUEST_TIMEOUT_MS,
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
 * Fetch an own-site URL (HEAD, GET when HEAD is refused), following redirects
 * by hand so every hop goes through the SSRF check. A redirect that leaves the
 * site is not followed.
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
      if (!isOwnHost(next.hostname, hostKey(original.hostname))) return "unknown";
      current = next;
      continue;
    }

    if (response.status === 404 || response.status === 410) return "dead";
    if (response.status >= 200 && response.status < 300) return "live";
    return "unknown";
  }

  return "unknown";
}

function knownUrls(contextTexts: string[], website?: string | null): Set<string> {
  const known = new Set<string>();
  for (const text of contextTexts) {
    for (const url of extractUrls(text)) known.add(normalizeUrl(url));
  }
  const site = websiteUrl(website);
  if (site) known.add(normalizeUrl(site.href));
  return known;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tidyAfterRemoval(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The reply without these URLs: a markdown link keeps its label, a bare URL goes. */
export function removeLinks(text: string, urls: string[]): string {
  if (urls.length === 0) return text;
  let result = text;
  for (const url of [...urls].sort((a, b) => b.length - a.length)) {
    const target = escapeRegExp(url);
    result = result
      .replace(new RegExp(`\\[([^\\]]*)\\]\\(\\s*<?${target}>?(?:\\s+"[^"]*")?\\s*\\)`, "g"), "$1")
      .replace(new RegExp(`^[ \\t]{0,3}\\[[^\\]]+\\]:[ \\t]*<?${target}>?.*$`, "gm"), "")
      .replace(new RegExp(`<${target}>`, "g"), "")
      .split(url)
      .join("");
  }
  return tidyAfterRemoval(result);
}

// Image alt text may hold one level of brackets and backslash escapes.
const IMAGE_ALT = String.raw`(?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\])*`;
const INLINE_IMAGE = new RegExp(
  String.raw`!\[${IMAGE_ALT}\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)`,
  "g",
);
const REFERENCE_IMAGE = new RegExp(String.raw`!\[${IMAGE_ALT}\]\[[^\]]*\]`, "g");
const HTML_IMAGE = /<img\b[^>]*>?/gi;
const LINK_DEFINITION = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*\S.*$/gm;

export interface OutboundReplyInput {
  response: string;
  /** Text the reply may legitimately quote URLs from (messages, docs, tool results). */
  contextTexts: string[];
  /** The tool results of this turn: the only off-site source of images. */
  toolResultTexts: string[];
  siteUrls?: string[];
  website?: string | null;
}

export interface OutboundReply {
  text: string;
  /** Images left in the reply. Clients only load these. */
  approvedImages: string[];
  removedImages: string[];
  removedLinks: string[];
}

/** Whether a reply has anything `sanitizeOutboundReply` could act on. */
export function hasLinksOrImages(text: string): boolean {
  return /https?:\/\/|!\[|<img\b/i.test(text);
}

/**
 * Last check on every AI reply, on any step, without network access. An image
 * loads by itself the moment the reply is shown, so anything the model wrote
 * into its URL is delivered without a click: only images from the
 * organization's site or returned word for word by a tool this turn stay.
 * Links from hosts nothing in the conversation vouches for are removed too.
 */
export function sanitizeOutboundReply(input: OutboundReplyInput): OutboundReply {
  const website = websiteUrl(input.website);
  const ownHost = website ? hostKey(website.hostname) : null;
  const toolUrls = new Set(input.toolResultTexts.flatMap(extractUrls).map(normalizeUrl));

  const imageAllowed = (url: string): boolean => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (ownHost !== null && isOwnHost(parsed.hostname, ownHost)) return true;
    return toolUrls.has(normalizeUrl(url));
  };

  const approvedImages: string[] = [];
  const removedImages: string[] = [];
  let text = input.response.replace(INLINE_IMAGE, (image: string, url: string) => {
    if (imageAllowed(url)) {
      approvedImages.push(url);
      return image;
    }
    removedImages.push(url);
    return "";
  });

  // Reference-style and raw HTML images have no place in a chat reply.
  text = text.replace(REFERENCE_IMAGE, (image) => {
    removedImages.push(image);
    return "";
  });
  text = text.replace(HTML_IMAGE, (image) => {
    removedImages.push(image);
    return "";
  });
  for (const [definition, label] of text.matchAll(LINK_DEFINITION)) {
    const shortcut = new RegExp(`!\\[${escapeRegExp(label)}\\]`, "gi");
    if (!shortcut.test(text)) continue;
    removedImages.push(definition.trim());
    text = text.replace(shortcut, "").replace(definition, "");
  }

  const known = knownUrls(input.contextTexts, input.website);
  for (const url of input.siteUrls ?? []) known.add(normalizeUrl(url));
  const keptImages = new Set(approvedImages.map(normalizeUrl));
  const removedLinks = extractUrls(text).filter((url) => {
    const key = normalizeUrl(url);
    if (known.has(key) || keptImages.has(key)) return false;
    return ownHost === null || !isOwnHost(new URL(url).hostname, ownHost);
  });
  text = removeLinks(text, removedLinks);

  return {
    text: removedImages.length > 0 ? tidyAfterRemoval(text) : text,
    approvedImages,
    removedImages,
    removedLinks,
  };
}

export class LinkGuardrailService {
  constructor(private readonly check: (url: string) => Promise<LinkStatus> = checkLink) {}

  async assessLinks(input: LinkAssessmentInput): Promise<BadLink[]> {
    const urls = extractUrls(input.response);
    if (urls.length === 0) return [];

    const known = knownUrls(input.contextTexts, input.website);
    const siteIndex = new Set((input.siteUrls ?? []).map(normalizeUrl));
    const website = websiteUrl(input.website);
    const ownHost = website ? hostKey(website.hostname) : null;

    const unknown = urls.filter((url) => {
      const key = normalizeUrl(url);
      return !known.has(key) && !siteIndex.has(key);
    });
    const onOwnSite = (url: string) =>
      ownHost !== null && isOwnHost(new URL(url).hostname, ownHost);
    const unverified = unknown
      .filter((url) => !onOwnSite(url))
      .map((url): BadLink => ({ url, reason: "unverified" }));
    const ownSiteUrls = unknown.filter(onOwnSite).slice(0, MAX_URLS_CHECKED);

    const results = await Promise.all(
      ownSiteUrls.map(async (url): Promise<BadLink | null> => {
        const status = await this.check(url).catch(() => "unknown" as const);
        if (status === "dead") return { url, reason: "dead" };
        if (siteIndex.size > 0) return { url, reason: "unlisted" };
        return null;
      }),
    );

    const badLinks = [...unverified, ...results.filter((link): link is BadLink => link !== null)];
    if (badLinks.length > 0) {
      logger.debug({ badLinks, checked: ownSiteUrls.length }, "Reply has bad links");
    }
    return badLinks;
  }
}
