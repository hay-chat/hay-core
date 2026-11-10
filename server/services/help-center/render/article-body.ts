/**
 * Turns a document's stored content into the HTML of an article page.
 *
 * Document content is untrusted wherever it came from (the editor, an upload,
 * a crawled site, a plugin), so whatever the source format, the last step
 * before the page is always the editor's HTML allow-list.
 */
import { Marked } from "marked";
import { ImportMethod } from "@server/entities/document.entity";
import { signDocumentImageUrls } from "@server/services/media-url.service";
import { sanitizeEditorHtml } from "@server/utils/sanitize-html";
import { escapeHtml, raw, type SafeHtml } from "./html";

const markdown = new Marked({ gfm: true });

/** Links the editor writes to another document of the organization. Group 1 is its id8. */
const DOCUMENT_LINK =
  /href="\/documents\/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^"]*"/gi;

/**
 * Sanitised article HTML. Editor documents already hold HTML; every other
 * import method holds markdown or plain text.
 */
export function sanitizedArticleHtml(content: string, importMethod: string): string {
  const source =
    importMethod === ImportMethod.EDITOR ? content : markdown.parse(content, { async: false });
  return sanitizeEditorHtml(source);
}

/**
 * The article body, ready for the page: sanitised, with links between
 * documents pointing at their article page (which answers 404 unless that
 * document is on the site too) and private document images signed so an
 * anonymous visitor can load them.
 */
export async function renderArticleBody(
  article: { content: string; importMethod: string },
  organizationId: string,
  href: (path: string) => string,
): Promise<SafeHtml> {
  const sanitized = sanitizedArticleHtml(article.content, article.importMethod).replace(
    DOCUMENT_LINK,
    (_match, documentId8: string) =>
      `href="${escapeHtml(href(`/articles/${documentId8.toLowerCase()}`))}"`,
  );
  return raw(await signDocumentImageUrls(sanitized, organizationId));
}
