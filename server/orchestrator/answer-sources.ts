import { DocumentVisibility, ImportMethod, type Document } from "@server/entities/document.entity";
import { documentRepository } from "@server/repositories/document.repository";
import { documentSourceRepository } from "@server/repositories/document-source.repository";
import type { AnswerSource } from "@server/services/webchat/public-message";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("answer-sources");

/** Most sources shown under one answer. */
const MAX_SOURCES = 5;

const isHttpUrl = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);

/**
 * The URL a shopper may follow to a knowledge document, or null when the
 * document is not public. Public means: pages crawled from the store's own
 * website (website sources, or the older single-page web import), or a
 * document the team marked "public" that has a link. Internal documents never
 * qualify, and neither does anything else synced from a plugin (a Notion or
 * helpdesk page is usually an internal link).
 */
export function publicDocumentUrl(
  document: Document,
  websiteSourceIds: Set<string>,
): string | null {
  if (document.visibility === DocumentVisibility.INTERNAL) return null;
  if (document.documentSourceId && websiteSourceIds.has(document.documentSourceId)) {
    return isHttpUrl(document.externalUrl) ? document.externalUrl : null;
  }
  if (document.importMethod === ImportMethod.WEB && isHttpUrl(document.sourceUrl)) {
    return document.sourceUrl;
  }
  if (document.visibility === DocumentVisibility.PUBLIC) {
    if (isHttpUrl(document.externalUrl)) return document.externalUrl;
    if (isHttpUrl(document.sourceUrl)) return document.sourceUrl;
  }
  return null;
}

/**
 * The public documents among those an AI answer used (`documentsUsed`, best
 * first), as `{ title, url }` for the widget. Tool results and other non-document
 * entries are ignored. Empty when none is public.
 */
export async function publicAnswerSources(
  organizationId: string,
  documentsUsed: ReadonlyArray<{ id: string; title?: string }> | undefined,
): Promise<AnswerSource[]> {
  const ids = [...new Set((documentsUsed ?? []).map((doc) => doc.id))];
  if (ids.length === 0) return [];
  try {
    const documents = await documentRepository.findByIdsAndOrganization(ids, organizationId);
    if (documents.length === 0) return [];

    const websiteSourceIds = new Set<string>();
    if (documents.some((doc) => doc.documentSourceId)) {
      const { WEBSITE_PLUGIN_ID } = await import("@server/services/importers/website-importer");
      for (const source of await documentSourceRepository.findByOrganization(organizationId)) {
        if (source.pluginId === WEBSITE_PLUGIN_ID) websiteSourceIds.add(source.id);
      }
    }

    const byId = new Map(documents.map((doc) => [doc.id, doc]));
    const sources: AnswerSource[] = [];
    const seenUrls = new Set<string>();
    for (const id of ids) {
      const document = byId.get(id);
      const url = document ? publicDocumentUrl(document, websiteSourceIds) : null;
      if (!document || !url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      sources.push({ title: document.title?.trim() || url, url });
      if (sources.length === MAX_SOURCES) break;
    }
    return sources;
  } catch (error) {
    // Sources are a nicety: never let them stop the answer.
    logger.warn({ err: error, organizationId }, "Could not resolve answer sources");
    return [];
  }
}
