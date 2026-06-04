import axios, { type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { URL } from "url";
import { EventEmitter } from "events";
import { createLogger } from "@server/lib/logger";
import { validateUrlForSSRF } from "@server/utils/ssrf";

const logger = createLogger("web-scraper");

export interface ScrapeProgress {
  status: "discovering" | "crawling" | "processing" | "completed" | "error";
  totalPages: number;
  processedPages: number;
  currentUrl?: string;
  error?: string;
}

export interface DiscoveredPage {
  url: string;
  title?: string;
  description?: string;
  discoveredAt: Date;
  selected?: boolean;
}

export interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  html: string;
  crawledAt: Date;
  /** Value of the HTTP `Last-Modified` response header, if the server sent one. */
  lastModified?: string;
}

/** A URL discovered via sitemap, carrying its `<lastmod>` when present. */
export interface SitemapEntry {
  url: string;
  lastmod?: string;
}

const HAY_USER_AGENT = "Mozilla/5.0 (compatible; HayDocumentImporter/1.0)";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class WebScraperService extends EventEmitter {
  private visitedUrls = new Set<string>();
  private urlQueue: string[] = [];
  private scrapedPages: ScrapedPage[] = [];
  private discoveredPages: DiscoveredPage[] = [];
  private baseUrl!: URL;
  private maxPages = 1500; // Safety limit
  private totalUrlsDiscovered = 0; // Track total URLs found (sitemap + crawled)
  private hasSitemap = false; // Track if we found a sitemap

  constructor() {
    super();
  }

  async discoverUrls(url: string): Promise<DiscoveredPage[]> {
    // Validate the base URL against SSRF before proceeding
    await validateUrlForSSRF(url);

    this.baseUrl = new URL(url);
    this.visitedUrls.clear();
    this.urlQueue = [url];
    this.discoveredPages = [];
    this.totalUrlsDiscovered = 0; // Reset counter
    this.hasSitemap = false; // Reset flag

    try {
      // Step 1: Try to find sitemap
      this.emitProgress("discovering", 0, 0);
      const sitemapEntries = await this.discoverSitemap();
      const sitemapUrls = sitemapEntries.map((e) => e.url);

      if (sitemapUrls.length > 0) {
        this.urlQueue = sitemapUrls;
        this.totalUrlsDiscovered = sitemapUrls.length; // Set initial count from sitemap
        this.hasSitemap = true; // Mark that we have a sitemap
        logger.info({ count: sitemapUrls.length }, "Found URLs from sitemap(s)");

        // Immediately emit progress showing all URLs found in sitemap
        this.emit("discovery-progress", {
          status: "discovering",
          found: this.totalUrlsDiscovered, // All URLs from sitemap
          processed: 0, // None processed yet
          total: this.totalUrlsDiscovered, // Total expected
          currentUrl: "Processing sitemap URLs...",
          discoveredPages: [], // Initial empty array
        });
      } else {
        // Step 2: Crawl the website to discover URLs
        this.totalUrlsDiscovered = 1; // Starting with just the base URL
        this.hasSitemap = false;
        logger.info("No sitemap found, crawling from base URL");
      }

      // Step 3: Discover all URLs with basic metadata
      await this.discoverPages();

      if (this.discoveredPages.length === 0) {
        logger.warn(
          { url, visitedUrls: this.visitedUrls.size },
          "Discovery completed with no pages found. The site may be blocking automated requests or requires JavaScript rendering.",
        );
      }

      this.emitProgress("completed", this.discoveredPages.length, this.discoveredPages.length);
      return this.discoveredPages;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.emitProgress("error", 0, 0, undefined, errorMessage);
      throw error;
    }
  }

  async scrapeSelectedPages(pages: DiscoveredPage[]): Promise<ScrapedPage[]> {
    this.scrapedPages = [];
    const selectedPages = pages.filter((p) => p.selected !== false);

    try {
      this.emitProgress("crawling", selectedPages.length, 0);

      for (let i = 0; i < selectedPages.length; i++) {
        const page = selectedPages[i];
        this.emitProgress("crawling", selectedPages.length, i + 1, page.url);

        const scrapedPage = await this.scrapePage(page.url);
        if (scrapedPage) {
          this.scrapedPages.push(scrapedPage);
        }

        // Delay between pages to avoid rate limiting
        await this.delay(200);
      }

      this.emitProgress("completed", this.scrapedPages.length, this.scrapedPages.length);
      return this.scrapedPages;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.emitProgress("error", 0, 0, undefined, errorMessage);
      throw error;
    }
  }

  async scrapeWebsite(url: string): Promise<ScrapedPage[]> {
    await validateUrlForSSRF(url);

    this.baseUrl = new URL(url);
    this.visitedUrls.clear();
    this.urlQueue = [url];
    this.scrapedPages = [];

    try {
      // Step 1: Try to find sitemap
      this.emitProgress("discovering", 0, 0);
      const sitemapEntries = await this.discoverSitemap();
      const sitemapUrls = sitemapEntries.map((e) => e.url);

      if (sitemapUrls.length > 0) {
        this.urlQueue = sitemapUrls;
        logger.info({ count: sitemapUrls.length }, "Found URLs from sitemap(s)");
      } else {
        // Step 2: Crawl the website starting from the base URL
        logger.info("No sitemap found, crawling from base URL");
      }

      // Step 3: Process all URLs
      await this.crawlUrls();

      this.emitProgress("completed", this.scrapedPages.length, this.scrapedPages.length);
      return this.scrapedPages;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.emitProgress("error", 0, 0, undefined, errorMessage);
      throw error;
    }
  }

  private emitProgress(
    status: ScrapeProgress["status"],
    totalPages: number,
    processedPages: number,
    currentUrl?: string,
    error?: string,
  ) {
    const progress: ScrapeProgress = {
      status,
      totalPages,
      processedPages,
      currentUrl,
      error,
    };
    this.emit("progress", progress);
  }

  private async discoverSitemap(): Promise<SitemapEntry[]> {
    const possibleSitemapPaths = [
      "/sitemap.xml",
      "/sitemap_index.xml",
      "/sitemap.xml.gz",
      "/sitemap",
      "/sitemap.txt",
    ];

    for (const path of possibleSitemapPaths) {
      try {
        const sitemapUrl = new URL(path, this.baseUrl).href;
        await validateUrlForSSRF(sitemapUrl);

        const fetchConfig = {
          timeout: 10000,
          maxContentLength: 5 * 1024 * 1024, // 5MB limit
          headers: { "User-Agent": HAY_USER_AGENT },
        };

        let response = await axios.get(sitemapUrl, fetchConfig);

        // Retry with browser User-Agent on 403
        if (response.status === 403) {
          logger.debug({ sitemapUrl }, "Sitemap returned 403, retrying with browser User-Agent");
          response = await axios.get(sitemapUrl, {
            ...fetchConfig,
            headers: { "User-Agent": BROWSER_USER_AGENT },
          });
        }

        if (response.status === 200) {
          const entries = await this.parseSitemap(response.data, sitemapUrl);
          if (entries.length > 0) {
            return entries;
          }
        }
      } catch (error) {
        // Continue trying other sitemap locations
        continue;
      }
    }

    return [];
  }

  private async parseSitemap(content: string, sitemapUrl: string): Promise<SitemapEntry[]> {
    const entries: SitemapEntry[] = [];
    const $ = cheerio.load(content, { xmlMode: true });

    // Check if this is a sitemap index file (contains <sitemap> elements)
    const sitemapElements = $("sitemap > loc");
    if (sitemapElements.length > 0) {
      logger.info(
        { count: sitemapElements.length, sitemapUrl },
        "Found sitemap index with sub-sitemaps",
      );

      // This is a sitemap index, recursively fetch and parse sub-sitemaps
      const subSitemapUrls: string[] = [];
      sitemapElements.each((_: number, element: Element) => {
        const url = $(element).text().trim();
        if (url) {
          subSitemapUrls.push(url);
        }
      });

      // Process sub-sitemaps in parallel (but limit concurrency)
      const concurrencyLimit = 5;
      for (let i = 0; i < subSitemapUrls.length; i += concurrencyLimit) {
        const batch = subSitemapUrls.slice(i, i + concurrencyLimit);
        const batchPromises = batch.map(async (subSitemapUrl) => {
          try {
            logger.debug({ subSitemapUrl }, "Fetching sub-sitemap");
            await validateUrlForSSRF(subSitemapUrl);
            const response = await axios.get(subSitemapUrl, {
              timeout: 10000,
              maxContentLength: 5 * 1024 * 1024,
              headers: { "User-Agent": HAY_USER_AGENT },
            });

            if (response.status === 200) {
              // Recursively parse the sub-sitemap
              const subEntries = await this.parseSitemap(response.data, subSitemapUrl);
              logger.debug(
                { count: subEntries.length, subSitemapUrl },
                "Found URLs in sub-sitemap",
              );
              return subEntries;
            }
          } catch (error) {
            logger.error({ err: error, subSitemapUrl }, "Failed to fetch sub-sitemap");
          }
          return [] as SitemapEntry[];
        });

        const batchResults = await Promise.all(batchPromises);
        for (const subEntries of batchResults) {
          entries.push(...subEntries);
        }
      }

      // If this was a sitemap index and we found URLs, return them prioritized
      if (entries.length > 0) {
        logger.info({ count: entries.length }, "Total URLs from sitemap index");
        return this.prioritizeEntries(entries, this.maxPages);
      }
    }

    // Parse regular sitemap (contains <url> elements with optional <lastmod>)
    const urlElements = $("url");
    if (urlElements.length > 0) {
      logger.info({ count: urlElements.length, sitemapUrl }, "Found regular sitemap");
      urlElements.each((_: number, element: Element) => {
        const url = $(element).children("loc").first().text().trim();
        // Always check if URL is from same domain
        if (url && this.isSameDomain(url)) {
          const lastmod = $(element).children("lastmod").first().text().trim() || undefined;
          entries.push({ url, lastmod });
        }
      });
    }

    // Parse text sitemap (one URL per line — no lastmod available)
    if (entries.length === 0 && !content.includes("<")) {
      const lines = content.split("\n");
      for (const line of lines) {
        const url = line.trim();
        if (url && url.startsWith("http") && this.isSameDomain(url)) {
          entries.push({ url });
        }
      }
    }

    logger.debug({ count: entries.length, sitemapUrl }, "Returning URLs from sitemap");
    return this.prioritizeEntries(entries, this.maxPages);
  }

  private async crawlUrls(): Promise<void> {
    const totalUrls = this.urlQueue.length;
    let processedCount = 0;

    while (this.urlQueue.length > 0 && this.scrapedPages.length < this.maxPages) {
      const url = this.urlQueue.shift()!;

      if (this.visitedUrls.has(url)) {
        continue;
      }

      this.visitedUrls.add(url);
      processedCount++;

      this.emitProgress("crawling", totalUrls, processedCount, url);

      try {
        const page = await this.scrapePage(url);
        if (page) {
          this.scrapedPages.push(page);

          // Extract and queue new URLs from the page
          const newUrls = this.extractUrls(page.html, url);
          for (const newUrl of newUrls) {
            if (!this.visitedUrls.has(newUrl) && !this.urlQueue.includes(newUrl)) {
              this.urlQueue.push(newUrl);
            }
          }
        }
      } catch (error) {
        logger.error({ err: error, url }, "Failed to scrape URL");
        // Continue with other URLs
      }

      // Delay between pages to avoid rate limiting
      await this.delay(200);
    }
  }

  /**
   * Fetch a page and return the full HTML for Readability processing.
   * Handles 429 rate limiting by respecting Retry-After headers.
   */
  private async scrapePage(url: string): Promise<ScrapedPage | null> {
    try {
      const response = await this.fetchWithRetryAfter(url, {
        timeout: 15000,
        maxContentLength: 10 * 1024 * 1024, // 10MB limit
        headers: {
          "User-Agent": HAY_USER_AGENT,
        },
      });

      if (response.status !== 200) {
        logger.debug({ url, status: response.status }, "Skipping scrape: non-200 status");
        return null;
      }

      // Skip HTTP redirects (URL changed materially after following redirects)
      if (this.wasHttpRedirected(response, url)) {
        logger.debug({ url }, "Skipping scrape: redirected to different page");
        return null;
      }

      const fullHtml = response.data;

      // Skip client-side redirects (meta refresh, "Redirecting..." pages)
      if (this.isClientSideRedirect(fullHtml)) {
        logger.debug({ url }, "Skipping scrape: client-side redirect detected");
        return null;
      }

      const $ = cheerio.load(fullHtml);

      // Extract title from the page
      const title = $("title").text() || $("h1").first().text() || "Untitled";

      // Get plain text for the content field
      $("script, style").remove();
      const textContent = $.text().replace(/\s+/g, " ").trim();

      const lastModifiedHeader = response.headers["last-modified"];

      return {
        url,
        title: title.trim(),
        content: textContent,
        html: fullHtml, // Return full HTML — Readability handles content extraction
        crawledAt: new Date(),
        lastModified: typeof lastModifiedHeader === "string" ? lastModifiedHeader : undefined,
      };
    } catch (error) {
      logger.error({ err: error, url }, "Error scraping URL");
      return null;
    }
  }

  /**
   * Public, stateless primitives used by the website document-source importer.
   * Unlike discoverUrls/scrapeWebsite these do not crawl the whole site or
   * emit progress events — they fetch exactly what is asked for.
   */

  /** Fetch and return the sitemap entries (with `<lastmod>`) for a site, or [] if none. */
  async getSitemapEntries(siteUrl: string): Promise<SitemapEntry[]> {
    await validateUrlForSSRF(siteUrl);
    this.baseUrl = new URL(siteUrl);
    return this.discoverSitemap();
  }

  /** Fetch a single page's HTML + title + Last-Modified header. Returns null on failure. */
  async fetchPageContent(url: string): Promise<ScrapedPage | null> {
    return this.scrapePage(url);
  }

  /**
   * Fetch a URL with automatic retry on 429 (Too Many Requests).
   * Respects the Retry-After header from the server.
   */
  private async fetchWithRetryAfter(
    url: string,
    config: Record<string, unknown>,
  ): Promise<AxiosResponse> {
    await validateUrlForSSRF(url);

    const fetchConfig = {
      ...config,
      validateStatus: () => true, // Accept all status codes so callers can inspect them
    };

    let response = await axios.get(url, fetchConfig);

    // Handle 429 with single retry respecting Retry-After header
    if (response.status === 429) {
      const retryAfter = response.headers["retry-after"];
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;
      const clampedWaitMs = Math.min(waitMs, 10000); // Cap at 10 seconds

      logger.debug({ url, waitMs: clampedWaitMs }, "Rate limited (429), retrying");
      await this.delay(clampedWaitMs);

      response = await axios.get(url, fetchConfig);
    }

    // Handle 403 by retrying with a browser-like User-Agent (bot protection fallback)
    if (response.status === 403) {
      const currentUA = (config.headers as Record<string, string>)?.["User-Agent"] ?? "";
      if (currentUA !== BROWSER_USER_AGENT) {
        logger.debug({ url }, "Got 403, retrying with browser User-Agent");
        const fallbackConfig = {
          ...fetchConfig,
          headers: {
            ...((config.headers as Record<string, string>) || {}),
            "User-Agent": BROWSER_USER_AGENT,
          },
        };
        response = await axios.get(url, fallbackConfig);
      }
    }

    return response;
  }

  /**
   * Score a URL for priority sorting. Lower score = higher priority.
   * Prioritizes root locale, shorter paths, and non-blog content.
   */
  private scoreUrl(url: string): number {
    try {
      const parsed = new URL(url);
      const pathSegments = parsed.pathname.split("/").filter(Boolean);
      let score = 0;

      // Locale-prefixed paths are lower priority (e.g., /en-be/, /de-ch/)
      // These are typically duplicates of the default locale content
      const localePattern = /^[a-z]{2}(-[a-z]{2})?$/i;
      if (pathSegments.length > 0 && localePattern.test(pathSegments[0])) {
        score += 100;
      }

      // Blog/article pages are lower priority (high volume, less useful for knowledge bases)
      const lowPriorityPatterns =
        /\/(blog|blogs|articles?|news|press|tag|tags|category|categories)\//i;
      if (lowPriorityPatterns.test(parsed.pathname)) {
        score += 50;
      }

      // Prefer shallower pages (depth penalty)
      score += pathSegments.length * 2;

      return score;
    } catch {
      return 1000; // Invalid URLs go last
    }
  }

  /**
   * Sort URLs by priority and return the top N.
   * Keeps higher-value pages (root locale, products, collections) over
   * lower-value ones (locale duplicates, blog posts).
   */
  private prioritizeUrls(urls: string[], limit: number): string[] {
    if (urls.length <= limit) {
      return urls;
    }

    const sorted = [...urls].sort((a, b) => this.scoreUrl(a) - this.scoreUrl(b));
    const result = sorted.slice(0, limit);

    const dropped = urls.length - limit;
    logger.info(
      { total: urls.length, kept: limit, dropped },
      "Prioritized URLs: dropped lowest-priority pages to stay within limit",
    );

    return result;
  }

  /**
   * Like prioritizeUrls but preserves each entry's lastmod. Deterministic sort
   * (by scoreUrl) so callers paginating by offset get a stable ordering across
   * runs — important for the document-source importer's resumable cursor.
   */
  private prioritizeEntries(entries: SitemapEntry[], limit: number): SitemapEntry[] {
    const sorted = [...entries].sort((a, b) => this.scoreUrl(a.url) - this.scoreUrl(b.url));
    if (entries.length <= limit) {
      return sorted;
    }
    const dropped = entries.length - limit;
    logger.info(
      { total: entries.length, kept: limit, dropped },
      "Prioritized sitemap entries: dropped lowest-priority pages to stay within limit",
    );
    return sorted.slice(0, limit);
  }

  private extractUrls(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    $("a[href]").each((_: number, element: Element) => {
      const href = $(element).attr("href");
      if (href) {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;

          // Only include URLs from the same domain
          if (this.isSameDomain(absoluteUrl)) {
            // Skip anchors, files, and common non-content pages
            if (
              !absoluteUrl.includes("#") &&
              !absoluteUrl.match(/\.(pdf|doc|docx|xls|xlsx|zip|png|jpg|jpeg|gif|svg)$/i) &&
              !absoluteUrl.includes("/login") &&
              !absoluteUrl.includes("/register") &&
              !absoluteUrl.includes("/signup") &&
              !absoluteUrl.includes("/signin")
            ) {
              urls.push(absoluteUrl);
            }
          }
        } catch {
          // Invalid URL, skip
        }
      }
    });

    return urls;
  }

  private isSameDomain(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname === this.baseUrl.hostname;
    } catch {
      return false;
    }
  }

  /**
   * Detect client-side redirects in HTML content.
   * Catches meta refresh tags and near-empty "Redirecting..." placeholder pages.
   */
  private isClientSideRedirect(html: string): boolean {
    const $ = cheerio.load(html);

    // Meta refresh redirect: <meta http-equiv="refresh" content="0;url=...">
    const metaRefresh = $('meta[http-equiv="refresh"]').attr("content");
    if (metaRefresh && /url\s*=/i.test(metaRefresh)) {
      return true;
    }

    // Near-empty pages with redirect-like language
    $("script, style, noscript").remove();
    const bodyText = $.text().replace(/\s+/g, " ").trim();

    if (bodyText.length < 200) {
      const redirectPatterns =
        /\b(redirecting|you are being redirected|moved permanently|page has moved|click here if not redirected)\b/i;
      if (redirectPatterns.test(bodyText)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an HTTP response was the result of following a redirect.
   * Allows benign normalizations (http→https, trailing slash).
   */
  private wasHttpRedirected(response: AxiosResponse, originalUrl: string): boolean {
    // axios surfaces the post-redirect URL on the underlying Node request's
    // response object (`request.res.responseUrl`), which is not part of the
    // typed axios surface — narrow it from `unknown` instead of casting.
    const request: unknown = response.request;
    const res =
      typeof request === "object" && request !== null && "res" in request
        ? (request as { res?: unknown }).res
        : undefined;
    const responseUrl =
      typeof res === "object" && res !== null && "responseUrl" in res
        ? (res as { responseUrl?: unknown }).responseUrl
        : undefined;
    const finalUrl = typeof responseUrl === "string" ? responseUrl : undefined;
    if (!finalUrl) {
      return false;
    }

    try {
      const original = new URL(originalUrl);
      const final_ = new URL(finalUrl);

      const normalizePath = (p: string) => p.replace(/\/+$/, "");

      // Allow http→https upgrade and trailing slash normalization
      if (
        original.hostname === final_.hostname &&
        normalizePath(original.pathname) === normalizePath(final_.pathname) &&
        original.search === final_.search
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  private async discoverPages(): Promise<void> {
    const initialQueueSize = this.urlQueue.length;
    let processedCount = 0;

    // Emit initial progress with total URLs found from sitemap or initial crawl
    this.emitProgress("discovering", initialQueueSize, 0, this.baseUrl.href);

    // Don't emit initial progress here if we already have URLs in queue (from sitemap)
    // Only emit if this is the first URL (no sitemap found)
    if (initialQueueSize === 1) {
      this.emit("discovery-progress", {
        status: "discovering",
        found: this.totalUrlsDiscovered, // Total URLs discovered
        processed: 0, // Successfully fetched and validated pages
        total: this.totalUrlsDiscovered, // Expected total
        currentUrl: this.baseUrl.href,
        discoveredPages: [], // Initial empty array
      });
    }

    while (this.urlQueue.length > 0 && this.discoveredPages.length < this.maxPages) {
      const url = this.urlQueue.shift()!;

      if (this.visitedUrls.has(url)) {
        continue;
      }

      this.visitedUrls.add(url);
      processedCount++;

      // Emit detailed progress with discovered count and pages
      this.emit("discovery-progress", {
        status: "discovering",
        found: this.totalUrlsDiscovered, // Use stable counter
        processed: this.discoveredPages.length, // Successfully processed pages with metadata
        total: this.totalUrlsDiscovered, // Total remains stable for sitemap case
        currentUrl: url,
        discoveredPages: [...this.discoveredPages], // Include discovered pages so far
      });

      this.emitProgress(
        "discovering",
        initialQueueSize + this.urlQueue.length,
        processedCount,
        url,
      );

      try {
        // Fetch page to get title and discover more URLs
        const response = await this.fetchWithRetryAfter(url, {
          timeout: 10000,
          maxContentLength: 5 * 1024 * 1024, // 5MB for discovery
          headers: {
            "User-Agent": HAY_USER_AGENT,
          },
        });

        // Skip error pages (4xx, 5xx)
        if (response.status >= 400) {
          logger.warn({ url, status: response.status }, "Skipping URL: error status");
          continue;
        }

        // Skip HTTP redirects (URL changed materially after following redirects)
        if (this.wasHttpRedirected(response, url)) {
          logger.debug({ url }, "Skipping URL: redirected to different page");
          continue;
        }

        if (response.status === 200) {
          const html = response.data;

          // Skip client-side redirects (meta refresh, "Redirecting..." pages)
          if (this.isClientSideRedirect(html)) {
            logger.debug({ url }, "Skipping URL: client-side redirect detected");
            continue;
          }

          const $ = cheerio.load(html);

          // Extract page metadata
          const title = $("title").text() || $("h1").first().text() || "Untitled";
          const description =
            $('meta[name="description"]').attr("content") ||
            $('meta[property="og:description"]').attr("content") ||
            "";

          this.discoveredPages.push({
            url,
            title: title.trim(),
            description: description.trim(),
            discoveredAt: new Date(),
            selected: true, // Default to selected
          });

          // Extract and queue new URLs from the page
          const newUrls = this.extractUrls(html, url);
          let newUrlsAdded = 0;
          for (const newUrl of newUrls) {
            if (!this.visitedUrls.has(newUrl) && !this.urlQueue.includes(newUrl)) {
              this.urlQueue.push(newUrl);
              newUrlsAdded++;
            }
          }

          // Update total count if we found new URLs (only for crawling mode, not sitemap)
          if (newUrlsAdded > 0 && !this.hasSitemap) {
            this.totalUrlsDiscovered += newUrlsAdded;
          }
        }
      } catch (error) {
        // Network errors, timeouts, etc. — skip entirely
        logger.error({ err: error, url }, "Failed to discover URL");
      }

      // Delay between pages to avoid rate limiting
      await this.delay(100);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
