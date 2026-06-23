/**
 * Website Document Importer (built-in)
 *
 * Implements the same DocumentImporterContract that document_importer plugins
 * expose, but for a plain website — so a website can be a first-class
 * DocumentSource (synced, deduped, freshness-tracked) without being a plugin.
 *
 * Resolution: a website DocumentSource carries pluginId === WEBSITE_PLUGIN_ID,
 * which the sync service maps to this importer instead of a plugin router.
 *
 * Discovery strategy (decided): sitemap-first. When a sitemap exists we get the
 * full URL list plus per-page `<lastmod>`, giving cheap incremental sync. When
 * no sitemap exists we fall back to a single bounded crawl (maxPages cap) with
 * no per-page freshness — every sync refetches those pages.
 *
 * Statelessness: the contract is called many times per run (cursor pagination)
 * but a fresh importer is constructed per sync run. We enumerate once and cache
 * for the lifetime of the instance; the cursor is a numeric offset into the
 * deterministically-ordered enumeration so a partial run resumes cleanly for
 * sitemap-backed sites. (Crawl-fallback ordering is best-effort across runs.)
 */

import { URL } from "url";
import { WebScraperService } from "@server/services/web-scraper.service";
import { HtmlProcessor } from "@server/processors/html.processor";
import { headlessBrowserService } from "@server/services/headless-browser.service";
import { isExtractionPoor } from "@server/utils/extraction-quality";
import { validateUrlForSSRF } from "@server/utils/ssrf";
import { createLogger } from "@server/lib/logger";
import type { DocumentSource } from "@server/entities/document-source.entity";
import type {
  DocumentImporterContract,
  DocumentImporterExternalPage,
  DocumentImporterFetchedPage,
  DocumentImporterPageChange,
  DocumentImporterRoot,
} from "@server/types/plugin-sdk.types";

const logger = createLogger("website-importer");

/** Sentinel pluginId stored on website DocumentSources (they are not plugins). */
export const WEBSITE_PLUGIN_ID = "core:website";
/** sourceType stored on website DocumentSources. */
export const WEBSITE_SOURCE_TYPE = "website";

/** True when a DocumentSource is a built-in website source. */
export function isWebsiteSource(source: Pick<DocumentSource, "pluginId">): boolean {
  return source.pluginId === WEBSITE_PLUGIN_ID;
}

/** How many pages to return per discover()/listChanges() call. */
const PAGE_SIZE = 50;

type EnumeratedPage = { url: string; lastmod?: string; title?: string };

export class WebsiteImporter implements DocumentImporterContract {
  private readonly scraper = new WebScraperService();
  private readonly htmlProcessor = new HtmlProcessor();
  private enumeration?: EnumeratedPage[];

  constructor(private readonly source: DocumentSource) {}

  /** The site URL to crawl, from config.url (falls back to externalRootId). */
  private baseUrl(): string {
    const fromConfig = this.source.config?.url;
    const url = typeof fromConfig === "string" ? fromConfig : this.source.externalRootId;
    if (!url) {
      throw new Error(`Website source ${this.source.id} has no url in config or externalRootId`);
    }
    return url;
  }

  /**
   * A website has a single implicit root: the site itself. Provided for
   * contract completeness; the create flow sets externalRootId directly and
   * never needs a picker.
   */
  async listRoots(): Promise<DocumentImporterRoot[]> {
    const url = this.baseUrl();
    return [{ id: url, label: new URL(url).hostname }];
  }

  async discover(input: { cursor?: string }): Promise<{
    pages: DocumentImporterExternalPage[];
    nextCursor?: string;
    total?: number;
  }> {
    const all = await this.enumerate();
    const offset = this.parseCursor(input.cursor);
    const slice = all.slice(offset, offset + PAGE_SIZE);

    const pages: DocumentImporterExternalPage[] = slice.map((page) => ({
      externalId: page.url,
      title: page.title ?? page.url,
      // No lastmod (crawl fallback / sitemap without <lastmod>) → treat as
      // "changed now" so the page is (re)fetched. fetchPage refines this from
      // the Last-Modified header when the server provides one.
      externalUpdatedAt: this.toIso(page.lastmod) ?? new Date().toISOString(),
      externalUrl: page.url,
    }));

    const next = offset + PAGE_SIZE;
    // We enumerate the whole site up front, so the total page count is known
    // and lets the sync engine render an "X of Y" progress bar.
    return { pages, nextCursor: next < all.length ? String(next) : undefined, total: all.length };
  }

  async fetchPage(input: { externalId: string }): Promise<DocumentImporterFetchedPage> {
    const url = input.externalId;
    await validateUrlForSSRF(url);

    const page = await this.scraper.fetchPageContent(url);
    if (!page) {
      throw new Error(`Failed to fetch page: ${url}`);
    }

    let processed = await this.htmlProcessor.process(Buffer.from(page.html), page.title);

    // Quality fallback: re-render with a headless browser when static HTML
    // yields poor extraction (JS-heavy pages). Mirrors the previous web-import
    // pipeline so converging onto sources is not a quality regression.
    if (isExtractionPoor(processed.content, page.html)) {
      try {
        const rendered = await headlessBrowserService.renderPage(url);
        const reprocessed = await this.htmlProcessor.process(Buffer.from(rendered), page.title);
        if (
          !isExtractionPoor(reprocessed.content, rendered) ||
          reprocessed.content.length > processed.content.length
        ) {
          processed = reprocessed;
        }
      } catch (err) {
        logger.warn({ err, url }, "Headless fallback failed, using static extraction");
      }
    }

    return {
      externalId: url,
      title: page.title,
      markdown: processed.content,
      externalUpdatedAt: this.toIso(page.lastModified) ?? new Date().toISOString(),
      externalUrl: url,
    };
  }

  async listChanges(input: { since: string; cursor?: string }): Promise<{
    changes: DocumentImporterPageChange[];
    nextCursor?: string;
  }> {
    const all = await this.enumerate();
    const sinceMs = new Date(input.since).getTime();

    // A page is "changed" when its lastmod is newer than `since`. Pages without
    // a lastmod carry no freshness signal, so we conservatively treat them as
    // changed (the upsert path dedupes by Last-Modified where available).
    // Deletions are reconciled by the weekly full sweep, not here.
    const changed = all.filter((page) => {
      const iso = this.toIso(page.lastmod);
      if (!iso) return true;
      return new Date(iso).getTime() > sinceMs;
    });

    const offset = this.parseCursor(input.cursor);
    const slice = changed.slice(offset, offset + PAGE_SIZE);

    const changes: DocumentImporterPageChange[] = slice.map((page) => ({
      externalId: page.url,
      op: "upsert",
      externalUpdatedAt: this.toIso(page.lastmod),
    }));

    const next = offset + PAGE_SIZE;
    return { changes, nextCursor: next < changed.length ? String(next) : undefined };
  }

  /**
   * Enumerate the site's pages once, cached for this importer's lifetime.
   * Sitemap-first (carries lastmod); bounded crawl fallback otherwise.
   */
  private async enumerate(): Promise<EnumeratedPage[]> {
    if (this.enumeration) return this.enumeration;
    const base = this.baseUrl();

    const sitemap = await this.scraper.getSitemapEntries(base);
    if (sitemap.length > 0) {
      this.enumeration = sitemap.map((e) => ({ url: e.url, lastmod: e.lastmod }));
      logger.info(
        { sourceId: this.source.id, count: this.enumeration.length },
        "Enumerated pages from sitemap",
      );
      return this.enumeration;
    }

    // No sitemap: bounded single-pass crawl. No per-page lastmod available, so
    // every sync will refetch these pages.
    const crawled = await this.scraper.discoverUrls(base);
    this.enumeration = crawled.map((p) => ({ url: p.url, title: p.title }));
    logger.info(
      { sourceId: this.source.id, count: this.enumeration.length },
      "No sitemap found — enumerated pages via bounded crawl (no per-page freshness)",
    );
    return this.enumeration;
  }

  private parseCursor(cursor?: string): number {
    if (!cursor) return 0;
    const n = parseInt(cursor, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Normalize a sitemap <lastmod> or Last-Modified header to an ISO string. */
  private toIso(value?: string): string | undefined {
    if (!value) return undefined;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
}
