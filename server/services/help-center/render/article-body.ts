/**
 * Turns a document's stored content into the HTML of an article page.
 *
 * Document content is untrusted wherever it came from (the editor, an upload,
 * a crawled site, a plugin), so whatever the source format, the last step
 * before the page is always the editor's HTML allow-list.
 */
import path from "path";
import { ImportMethod } from "@server/entities/document.entity";
import { createLogger } from "@server/lib/logger";
import { runWorker } from "@server/processors/run-worker";
import { signDocumentImageUrls } from "@server/services/media-url.service";
import { sanitizeEditorHtml } from "@server/utils/sanitize-html";
import { escapeHtml, raw, type SafeHtml } from "./html";

const logger = createLogger("help-center-article");

/** Same extension as this module: .ts under tsx/ts-jest, .js in the build. */
const MARKDOWN_WORKER = path.join(__dirname, `markdown.worker${path.extname(__filename)}`);

/**
 * Markdown parsing is quadratic on some inputs, and anyone who can edit a
 * document chooses the input. It therefore runs in a worker thread that is
 * stopped after this long, so one article can never hold up the server.
 */
const MARKDOWN_TIMEOUT_MS = 3_000;
const MARKDOWN_MAX_HEAP_MB = 128;
/** Larger documents are shown as plain text without trying. */
const MARKDOWN_MAX_LENGTH = 300_000;

/** Rendered bodies by document version, so a page view rarely parses anything. */
const RENDER_CACHE_MAX_ENTRIES = 300;
const renderCache = new Map<string, string>();

/** Links the editor writes to another document of the organization. Group 1 is its id8. */
const DOCUMENT_LINK =
  /href="\/documents\/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^"]*"/gi;

/** The text as paragraphs, for content that could not be parsed as markdown. */
function plainTextHtml(content: string): string {
  return content
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

async function markdownToHtml(content: string): Promise<string> {
  if (!content) return "";
  if (content.length > MARKDOWN_MAX_LENGTH) return plainTextHtml(content);
  try {
    return await runWorker<string>(
      MARKDOWN_WORKER,
      { content },
      { timeoutMs: MARKDOWN_TIMEOUT_MS, maxOldGenerationSizeMb: MARKDOWN_MAX_HEAP_MB },
    );
  } catch (error) {
    logger.warn({ err: error }, "Could not render an article as markdown; showing it as text");
    return plainTextHtml(content);
  }
}

/**
 * Sanitised article HTML. Editor documents already hold HTML; every other
 * import method holds markdown or plain text.
 */
export async function sanitizedArticleHtml(content: string, importMethod: string): Promise<string> {
  const source = importMethod === ImportMethod.EDITOR ? content : await markdownToHtml(content);
  return sanitizeEditorHtml(source);
}

async function cachedArticleHtml(article: {
  id: string;
  updatedAt: Date;
  content: string;
  importMethod: string;
}): Promise<string> {
  const key = `${article.id}:${new Date(article.updatedAt).getTime()}`;
  const cached = renderCache.get(key);
  if (cached !== undefined) return cached;
  const rendered = await sanitizedArticleHtml(article.content, article.importMethod);
  if (renderCache.size >= RENDER_CACHE_MAX_ENTRIES) {
    renderCache.delete(renderCache.keys().next().value as string);
  }
  renderCache.set(key, rendered);
  return rendered;
}

/**
 * The article body, ready for the page: sanitised, with links between
 * documents pointing at their article page (which answers 404 unless that
 * document is on the site too) and private document images signed so an
 * anonymous visitor can load them.
 */
export async function renderArticleBody(
  article: { id: string; updatedAt: Date; content: string; importMethod: string },
  organizationId: string,
  href: (path: string) => string,
): Promise<SafeHtml> {
  const sanitized = (await cachedArticleHtml(article)).replace(
    DOCUMENT_LINK,
    (_match, documentId8: string) =>
      `href="${escapeHtml(href(`/articles/${documentId8.toLowerCase()}`))}"`,
  );
  return raw(await signDocumentImageUrls(sanitized, organizationId));
}
