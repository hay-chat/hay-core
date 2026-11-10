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

/** The home page, every collection and every visible article, at their canonical addresses. */
export function buildSitemapXml(canonicalBase: string, collections: PublicCollection[]): string {
  const entry = (path: string, lastModified?: Date) =>
    `<url><loc>${escapeHtml(canonicalBase + path)}</loc>` +
    (lastModified ? `<lastmod>${lastModified.toISOString()}</lastmod>` : "") +
    `</url>`;
  const entries = [entry("/")];
  for (const collection of collections) {
    entries.push(entry(collectionPath(collection)));
    for (const article of collection.articles) {
      entries.push(entry(articlePath(article), article.updatedAt));
    }
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`
  );
}
