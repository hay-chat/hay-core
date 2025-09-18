import axios from "axios";
import * as cheerio from "cheerio";
import { URL } from "url";
import { EventEmitter } from "events";

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
}

export class WebScraperService extends EventEmitter {
  private visitedUrls = new Set<string>();
  private urlQueue: string[] = [];
  private scrapedPages: ScrapedPage[] = [];
  private discoveredPages: DiscoveredPage[] = [];
  private baseUrl!: URL;
  private maxPages = 500; // Safety limit
  private totalUrlsDiscovered = 0; // Track total URLs found (sitemap + crawled)
  private hasSitemap = false; // Track if we found a sitemap

  constructor() {
    super();
  }

  async discoverUrls(url: string): Promise<DiscoveredPage[]> {
    this.baseUrl = new URL(url);
    this.visitedUrls.clear();
    this.urlQueue = [url];
    this.discoveredPages = [];
    this.totalUrlsDiscovered = 0; // Reset counter
    this.hasSitemap = false; // Reset flag

    try {
      // Step 1: Try to find sitemap
      this.emitProgress("discovering", 0, 0);
      const sitemapUrls = await this.discoverSitemap();

      if (sitemapUrls.length > 0) {
        this.urlQueue = sitemapUrls;
        this.totalUrlsDiscovered = sitemapUrls.length; // Set initial count from sitemap
        this.hasSitemap = true; // Mark that we have a sitemap
        console.log(`Found ${sitemapUrls.length} URLs in sitemap`);

        // Immediately emit progress showing all URLs found in sitemap
        this.emit("discovery-progress", {
          status: "discovering",
          found: this.totalUrlsDiscovered, // All URLs from sitemap
          processed: 0, // None processed yet
          total: this.totalUrlsDiscovered, // Total expected
          currentUrl: "Processing sitemap URLs...",
        });
      } else {
        // Step 2: Crawl the website to discover URLs
        this.totalUrlsDiscovered = 1; // Starting with just the base URL
        this.hasSitemap = false;
        console.log("No sitemap found, crawling from base URL");
      }

      // Step 3: Discover all URLs with basic metadata
      await this.discoverPages();

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

        // Small delay to be respectful to the server
        await this.delay(100);
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
    this.baseUrl = new URL(url);
    this.visitedUrls.clear();
    this.urlQueue = [url];
    this.scrapedPages = [];

    try {
      // Step 1: Try to find sitemap
      this.emitProgress("discovering", 0, 0);
      const sitemapUrls = await this.discoverSitemap();

      if (sitemapUrls.length > 0) {
        this.urlQueue = sitemapUrls;
        console.log(`Found ${sitemapUrls.length} URLs in sitemap`);
      } else {
        // Step 2: Crawl the website starting from the base URL
        console.log("No sitemap found, crawling from base URL");
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

  private async discoverSitemap(): Promise<string[]> {
    const sitemapUrls: string[] = [];
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
        const response = await axios.get(sitemapUrl, {
          timeout: 10000,
          maxContentLength: 5 * 1024 * 1024, // 5MB limit
        });

        if (response.status === 200) {
          const urls = this.parseSitemap(response.data);
          if (urls.length > 0) {
            return urls;
          }
        }
      } catch (error) {
        // Continue trying other sitemap locations
        continue;
      }
    }

    return sitemapUrls;
  }

  private parseSitemap(content: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(content, { xmlMode: true });

    // Parse XML sitemap
    $("url > loc").each((_: number, element: cheerio.Element) => {
      const url = $(element).text().trim();
      if (url && this.isSameDomain(url)) {
        urls.push(url);
      }
    });

    // Parse sitemap index
    $("sitemap > loc").each((_: number, element: cheerio.Element) => {
      const url = $(element).text().trim();
      if (url && this.isSameDomain(url)) {
        urls.push(url);
      }
    });

    // Parse text sitemap (one URL per line)
    if (urls.length === 0 && !content.includes("<")) {
      const lines = content.split("\n");
      for (const line of lines) {
        const url = line.trim();
        if (url && url.startsWith("http") && this.isSameDomain(url)) {
          urls.push(url);
        }
      }
    }

    return urls.slice(0, this.maxPages);
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
        console.error(`Failed to scrape ${url}:`, error);
        // Continue with other URLs
      }

      // Small delay to be respectful to the server
      await this.delay(100);
    }
  }

  private async scrapePage(url: string): Promise<ScrapedPage | null> {
    try {
      // First try to get print version
      const printUrl = await this.findPrintVersion(url);
      const targetUrl = printUrl || url;

      const response = await axios.get(targetUrl, {
        timeout: 15000,
        maxContentLength: 10 * 1024 * 1024, // 10MB limit
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HayDocumentImporter/1.0)",
        },
      });

      if (response.status !== 200) {
        return null;
      }

      const $ = cheerio.load(response.data);

      // Remove unwanted elements
      $(
        "script, style, nav, header, footer, aside, .navigation, .menu, .sidebar, .ads, .advertisement",
      ).remove();

      // Extract title
      const title = $("title").text() || $("h1").first().text() || "Untitled";

      // Extract main content
      const mainContent =
        $("main, article, .content, .main-content, #content").html() || $("body").html() || "";

      // Get text content
      const textContent = $.text().replace(/\s+/g, " ").trim();

      return {
        url,
        title: title.trim(),
        content: textContent,
        html: mainContent,
        crawledAt: new Date(),
      };
    } catch (error) {
      console.error(`Error scraping ${url}:`, error);
      return null;
    }
  }

  private async findPrintVersion(url: string): Promise<string | null> {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        maxContentLength: 1 * 1024 * 1024, // 1MB for initial page
      });

      const $ = cheerio.load(response.data);

      // Look for print links
      const printSelectors = [
        'a[href*="print"]',
        'a[onclick*="print"]',
        'link[media="print"]',
        "a.print-link",
        "a.print-version",
      ];

      for (const selector of printSelectors) {
        const element = $(selector).first();
        if (element.length > 0) {
          const href = element.attr("href");
          if (href && !href.startsWith("javascript:")) {
            return new URL(href, url).href;
          }
        }
      }

      // Try common print URL patterns
      const printPatterns = [
        url + (url.includes("?") ? "&" : "?") + "print=true",
        url + (url.includes("?") ? "&" : "?") + "view=print",
        url.replace(/\.html?$/, ".print.html"),
      ];

      for (const printUrl of printPatterns) {
        try {
          const testResponse = await axios.head(printUrl, { timeout: 5000 });
          if (testResponse.status === 200) {
            return printUrl;
          }
        } catch {
          // Continue trying other patterns
        }
      }
    } catch (error) {
      // Ignore errors and return null
    }

    return null;
  }

  private extractUrls(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    $("a[href]").each((_: number, element: cheerio.Element) => {
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
      });
    }

    while (this.urlQueue.length > 0 && this.discoveredPages.length < this.maxPages) {
      const url = this.urlQueue.shift()!;

      if (this.visitedUrls.has(url)) {
        continue;
      }

      this.visitedUrls.add(url);
      processedCount++;

      // Emit detailed progress with discovered count
      this.emit("discovery-progress", {
        status: "discovering",
        found: this.totalUrlsDiscovered, // Use stable counter
        processed: this.discoveredPages.length, // Successfully processed pages with metadata
        total: this.totalUrlsDiscovered, // Total remains stable for sitemap case
        currentUrl: url,
      });

      this.emitProgress(
        "discovering",
        initialQueueSize + this.urlQueue.length,
        processedCount,
        url,
      );

      try {
        // Fetch page to get title and discover more URLs
        const response = await axios.get(url, {
          timeout: 10000,
          maxContentLength: 1 * 1024 * 1024, // 1MB for discovery
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; HayDocumentImporter/1.0)",
          },
        });

        if (response.status === 200) {
          const $ = cheerio.load(response.data);

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
          const newUrls = this.extractUrls(response.data, url);
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
        console.error(`Failed to discover ${url}:`, error);
        // Add URL with minimal info even if fetch failed
        this.discoveredPages.push({
          url,
          title: url.split("/").pop() || "Unknown",
          description: "",
          discoveredAt: new Date(),
          selected: false, // Default to not selected if failed
        });
      }

      // Small delay to be respectful to the server
      await this.delay(50);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
