import { IsNull, Not } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { SitePage } from "@server/database/entities/site-page.entity";
import { Document, DocumentationStatus } from "@server/entities/document.entity";
import { DocumentSource } from "@server/entities/document-source.entity";
import { Organization } from "@server/entities/organization.entity";
import { createLogger } from "@server/lib/logger";
import { WebScraperService } from "@server/services/web-scraper.service";
import { WEBSITE_PLUGIN_ID } from "@server/services/importers/website-importer";
import { hostKey, normalizeUrl, websiteUrl } from "@server/services/core/link-guardrail.service";

const logger = createLogger("site-index");

/** Big stores list every product in the sitemap; products have their own tool. */
const MAX_PAGES = 5000;
const INSERT_CHUNK = 500;
const MAX_RESULTS = 5;

export interface FoundPage {
  url: string;
  title: string;
}

/** "/products/blue-shirt.html" → "products blue shirt"; the root is "home". */
export function titleFromUrl(url: string): string {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
  const words = path
    .replace(/\.(html?|php|aspx?)$/i, "")
    .split(/[/\-_.]+/)
    .filter(Boolean)
    .join(" ");
  return (words || "home").slice(0, 500);
}

/** Search words: lowercase letters/digits, at least 2 characters. */
function searchTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 2),
    ),
  ];
}

/**
 * The organization's website pages, read from its sitemap, so the AI can link
 * to real pages (find_page_url) and the link check knows which URLs exist.
 */
export class SiteIndexService {
  private get pages() {
    return AppDataSource.getRepository(SitePage);
  }

  /** The website set in settings, else the site of a website document source. */
  async resolveWebsite(organizationId: string): Promise<string | null> {
    const organization = await AppDataSource.getRepository(Organization).findOne({
      where: { id: organizationId },
      select: { id: true, website: true },
    });
    if (organization?.website) return organization.website;

    const source = await AppDataSource.getRepository(DocumentSource).findOne({
      where: { organizationId, pluginId: WEBSITE_PLUGIN_ID, enabled: true },
      order: { createdAt: "ASC" },
    });
    const fromConfig = source?.config?.url;
    return (typeof fromConfig === "string" ? fromConfig : source?.externalRootId) ?? null;
  }

  /**
   * Replace the organization's pages with what its sitemap lists now. Keeps
   * the old pages when the sitemap cannot be read (returns null then).
   */
  async sync(organizationId: string): Promise<number | null> {
    const log = logger.child({ organizationId });
    const website = websiteUrl(await this.resolveWebsite(organizationId));
    if (!website) {
      await this.pages.delete({ organizationId });
      return 0;
    }

    let entries: Array<{ url: string }>;
    try {
      entries = await new WebScraperService().getSitemapEntries(website.origin);
    } catch (error) {
      log.warn(
        { error, website: website.origin },
        "Could not read the sitemap, keeping the old pages",
      );
      return null;
    }

    const host = hostKey(website.hostname);
    const seen = new Set<string>();
    const pages: Array<Pick<SitePage, "organizationId" | "url" | "title">> = [];
    for (const { url } of entries) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      const key = normalizeUrl(url);
      if (hostKey(parsed.hostname) !== host || seen.has(key) || url.length > 2048) continue;
      seen.add(key);
      pages.push({ organizationId, url, title: titleFromUrl(url) });
      if (pages.length >= MAX_PAGES) break;
    }

    await AppDataSource.transaction(async (manager) => {
      await manager.delete(SitePage, { organizationId });
      for (let i = 0; i < pages.length; i += INSERT_CHUNK) {
        await manager.insert(SitePage, pages.slice(i, i + INSERT_CHUNK));
      }
    });

    log.info({ website: website.origin, pages: pages.length }, "Site index synced");
    return pages.length;
  }

  /** Every organization that has a website or a website document source. */
  async syncAll(): Promise<void> {
    const withWebsite = await AppDataSource.getRepository(Organization).find({
      where: { website: Not(IsNull()) },
      select: { id: true },
    });
    const withSource = await AppDataSource.getRepository(DocumentSource).find({
      where: { pluginId: WEBSITE_PLUGIN_ID, enabled: true },
      select: { organizationId: true },
    });
    const ids = new Set([
      ...withWebsite.map((o) => o.id),
      ...withSource.map((s) => s.organizationId),
    ]);

    for (const id of ids) {
      await this.sync(id).catch((error) =>
        logger.error({ error, organizationId: id }, "Site index sync failed"),
      );
    }
  }

  /** Known page URLs: the site index plus every document's source URL. */
  async listUrls(organizationId: string): Promise<string[]> {
    const [pages, documents] = await Promise.all([
      this.pages.find({ where: { organizationId }, select: { url: true } }),
      AppDataSource.getRepository(Document).find({
        where: { organizationId, sourceUrl: Not(IsNull()) },
        select: { sourceUrl: true },
      }),
    ]);
    return [...pages.map((p) => p.url), ...documents.map((d) => d.sourceUrl!)];
  }

  /**
   * Pages whose URL or title matches the most query words. Imported documents
   * come first on a tie: their titles are real, site-index titles are guesses.
   */
  async search(organizationId: string, query: string): Promise<FoundPage[]> {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const patterns = terms.map((term) => `%${term.replace(/[%_\\]/g, "\\$&")}%`);

    const [pages, documents] = await Promise.all([
      this.pages
        .createQueryBuilder("page")
        .select(["page.url", "page.title"])
        .where("page.organizationId = :organizationId", { organizationId })
        .andWhere("(page.title ILIKE ANY(:patterns) OR page.url ILIKE ANY(:patterns))", {
          patterns,
        })
        .limit(300)
        .getMany(),
      AppDataSource.getRepository(Document)
        .createQueryBuilder("doc")
        .select(["doc.sourceUrl", "doc.title"])
        .where("doc.organizationId = :organizationId", { organizationId })
        .andWhere("doc.sourceUrl IS NOT NULL")
        .andWhere("doc.status NOT IN (:...hidden)", {
          hidden: [DocumentationStatus.ARCHIVED, DocumentationStatus.ERROR],
        })
        .andWhere("(doc.title ILIKE ANY(:patterns) OR doc.sourceUrl ILIKE ANY(:patterns))", {
          patterns,
        })
        .limit(100)
        .getMany(),
    ]);

    const score = (text: string) => {
      const lower = text.toLowerCase();
      return terms.filter((term) => lower.includes(term)).length;
    };
    const ranked = new Map<string, FoundPage & { score: number }>();
    for (const doc of documents) {
      const url = doc.sourceUrl!;
      ranked.set(normalizeUrl(url), {
        url,
        title: doc.title || titleFromUrl(url),
        score: score(`${doc.title ?? ""} ${url}`) + 0.5,
      });
    }
    for (const page of pages) {
      const key = normalizeUrl(page.url);
      if (ranked.has(key)) continue;
      ranked.set(key, {
        url: page.url,
        title: page.title,
        score: score(`${page.title} ${page.url}`),
      });
    }

    return [...ranked.values()]
      .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
      .slice(0, MAX_RESULTS)
      .map(({ url, title }) => ({ url, title }));
  }
}

export const siteIndexService = new SiteIndexService();
