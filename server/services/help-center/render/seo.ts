/** robots.txt and sitemap.xml for a help center. */
import type { PublicCollection } from "../public-content";
import { escapeHtml } from "./html";
import { articlePath, collectionPath } from "./urls";

/**
 * `canonicalBase` is the site's canonical address when search engines may
 * index it, or null to keep every crawler out (indexing switched off, or no
 * live site on this host).
 */
export function buildRobotsTxt(canonicalBase: string | null): string {
  if (!canonicalBase) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\nDisallow: /search\n\nSitemap: ${canonicalBase}/sitemap.xml\n`;
}

function latest(dates: Date[]): Date | undefined {
  let newest: Date | undefined;
  for (const date of dates) {
    if (!newest || new Date(date).getTime() > newest.getTime()) newest = new Date(date);
  }
  return newest;
}

/**
 * The home page, every collection and every visible article, at their
 * canonical addresses. A collection's lastmod is its newest article's, the
 * home page's the newest of all: the pages that list articles change when
 * one does.
 */
export function buildSitemapXml(canonicalBase: string, collections: PublicCollection[]): string {
  const entry = (path: string, lastModified?: Date) =>
    `<url><loc>${escapeHtml(canonicalBase + path)}</loc>` +
    (lastModified ? `<lastmod>${lastModified.toISOString()}</lastmod>` : "") +
    `</url>`;
  const collectionEntries = collections.map((collection) => {
    const lastModified = latest(collection.articles.map((article) => article.updatedAt));
    return {
      lastModified,
      entries: [
        entry(collectionPath(collection), lastModified),
        ...collection.articles.map((article) =>
          entry(articlePath(article), new Date(article.updatedAt)),
        ),
      ],
    };
  });
  const home = entry("/", latest(collectionEntries.flatMap((c) => c.lastModified ?? [])));
  const entries = [home, ...collectionEntries.flatMap((c) => c.entries)];
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`
  );
}
