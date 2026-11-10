/**
 * Everything the public help center site reads or writes. No other module
 * queries content for the site, so the visibility rule lives in one place:
 *
 *   an article is shown only while its document is published AND public AND
 *   placed in a collection of that help center.
 *
 * Every statement is scoped to the help center and its organization. Each
 * function is one statement: a page needs one of them.
 */
import { AppDataSource } from "@server/database/data-source";
import type { HelpCenter } from "@server/database/entities/help-center.entity";
import { idRange } from "./render/urls";

export type HelpCenterScope = Pick<HelpCenter, "id" | "organizationId">;

export interface PublicArticleSummary {
  id: string;
  title: string;
  description: string | null;
  updatedAt: Date;
}

export interface PublicCollection {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  articles: PublicArticleSummary[];
}

export interface PublicArticle extends PublicArticleSummary {
  content: string;
  importMethod: string;
  collection: { id: string; title: string };
}

export const SEARCH_QUERY_MAX_LENGTH = 100;
const SEARCH_RESULT_LIMIT = 20;

/** The visibility rule. `$1` is the help center id, `$2` its organization id. */
const VISIBLE_DOCUMENT = `d.status = 'published' AND d.visibility = 'public'`;
const FROM_VISIBLE_ARTICLES = `
  FROM help_center_collections c
  JOIN help_center_articles a ON a.collection_id = c.id AND a.organization_id = c.organization_id
  JOIN documents d ON d.id = a.document_id AND d.organization_id = c.organization_id
  WHERE c.help_center_id = $1 AND c.organization_id = $2 AND ${VISIBLE_DOCUMENT}`;
const SITE_ORDER = `ORDER BY c.position, c.created_at, c.id, a.position, a.created_at, a.id`;

interface CollectionArticleRow {
  collection_id: string;
  collection_title: string;
  collection_description: string | null;
  collection_icon: string | null;
  document_id: string;
  document_title: string | null;
  document_description: string | null;
  document_updated_at: Date;
}

const COLLECTION_ARTICLE_COLUMNS = `
  c.id AS collection_id, c.title AS collection_title,
  c.description AS collection_description, c.icon AS collection_icon,
  d.id AS document_id, d.title AS document_title,
  d.description AS document_description, d.updated_at AS document_updated_at`;

function groupByCollection(rows: CollectionArticleRow[]): PublicCollection[] {
  const collections = new Map<string, PublicCollection>();
  for (const row of rows) {
    let collection = collections.get(row.collection_id);
    if (!collection) {
      collection = {
        id: row.collection_id,
        title: row.collection_title,
        description: row.collection_description,
        icon: row.collection_icon,
        articles: [],
      };
      collections.set(row.collection_id, collection);
    }
    collection.articles.push({
      id: row.document_id,
      title: row.document_title ?? "",
      description: row.document_description,
      updatedAt: row.document_updated_at,
    });
  }
  return [...collections.values()];
}

/**
 * The site's collections in order, each with its visible articles in order.
 * A collection with no visible article is left out. Serves the home page and
 * the sitemap.
 */
export async function listCollections(scope: HelpCenterScope): Promise<PublicCollection[]> {
  const rows: CollectionArticleRow[] = await AppDataSource.query(
    `SELECT ${COLLECTION_ARTICLE_COLUMNS} ${FROM_VISIBLE_ARTICLES} ${SITE_ORDER}`,
    [scope.id, scope.organizationId],
  );
  return groupByCollection(rows);
}

/**
 * One collection with its visible articles, found by the first 8 hex
 * characters of its id. Null when none or more than one matches, or when it
 * has no visible article.
 */
export async function getCollection(
  scope: HelpCenterScope,
  collectionId8: string,
): Promise<PublicCollection | null> {
  const range = idRange(collectionId8);
  if (!range) return null;
  const rows: CollectionArticleRow[] = await AppDataSource.query(
    `SELECT ${COLLECTION_ARTICLE_COLUMNS} ${FROM_VISIBLE_ARTICLES}
       AND c.id BETWEEN $3 AND $4 ${SITE_ORDER}`,
    [scope.id, scope.organizationId, range.from, range.to],
  );
  const collections = groupByCollection(rows);
  return collections.length === 1 ? collections[0] : null;
}

interface ArticleRow {
  id: string;
  title: string | null;
  description: string | null;
  content: string | null;
  import_method: string;
  updated_at: Date;
  collection_id: string;
  collection_title: string;
}

/**
 * One visible article, found by the first 8 hex characters of its document
 * id. Null when none or more than one matches.
 */
export async function getArticle(
  scope: HelpCenterScope,
  documentId8: string,
): Promise<PublicArticle | null> {
  const range = idRange(documentId8);
  if (!range) return null;
  const rows: ArticleRow[] = await AppDataSource.query(
    `SELECT d.id, d.title, d.description, d.content, d.import_method, d.updated_at,
            c.id AS collection_id, c.title AS collection_title
     ${FROM_VISIBLE_ARTICLES} AND d.id BETWEEN $3 AND $4
     LIMIT 2`,
    [scope.id, scope.organizationId, range.from, range.to],
  );
  if (rows.length !== 1) return null;
  const [row] = rows;
  return {
    id: row.id,
    title: row.title ?? "",
    description: row.description,
    updatedAt: row.updated_at,
    content: row.content ?? "",
    importMethod: row.import_method,
    collection: { id: row.collection_id, title: row.collection_title },
  };
}

/** Trim, collapse whitespace and cap what a visitor typed in the search box. */
export function normalizeSearchQuery(input: unknown): string {
  if (typeof input !== "string") return "";
  // Control characters, NUL included, which Postgres refuses in a text parameter.
  const printable = Array.from(input, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  }).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, SEARCH_QUERY_MAX_LENGTH).trim();
}

/** An ILIKE pattern matching `query` as literal text anywhere in a value. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Visible articles whose title or content contains the query, title matches
 * first. Plain keyword matching: a public page must not spend embeddings or
 * model calls on anonymous traffic.
 */
export async function searchArticles(
  scope: HelpCenterScope,
  input: unknown,
): Promise<PublicArticleSummary[]> {
  const query = normalizeSearchQuery(input);
  if (!query) return [];
  const rows: Array<{
    id: string;
    title: string | null;
    description: string | null;
    updated_at: Date;
  }> = await AppDataSource.query(
    `SELECT d.id, d.title, d.description, d.updated_at
     ${FROM_VISIBLE_ARTICLES}
       AND (d.title ILIKE $3 ESCAPE '\\' OR d.content ILIKE $3 ESCAPE '\\')
     ORDER BY (d.title ILIKE $3 ESCAPE '\\') DESC NULLS LAST, d.title, d.id
     LIMIT ${SEARCH_RESULT_LIMIT}`,
    [scope.id, scope.organizationId, likePattern(query)],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    description: row.description,
    updatedAt: row.updated_at,
  }));
}

/**
 * Count one "Was this helpful?" answer on a visible article, given its
 * document id or the first 8 hex characters of it. Anything else changes
 * nothing.
 */
export async function recordArticleFeedback(
  scope: HelpCenterScope,
  documentIdOrId8: string,
  helpful: boolean,
): Promise<void> {
  const range = idRange(documentIdOrId8);
  if (!range) return;
  const column = helpful ? "helpful_count" : "unhelpful_count";
  await AppDataSource.query(
    `UPDATE help_center_articles a SET ${column} = a.${column} + 1
     FROM help_center_collections c, documents d
     WHERE c.id = a.collection_id AND c.organization_id = a.organization_id
       AND d.id = a.document_id AND d.organization_id = a.organization_id
       AND c.help_center_id = $1 AND a.organization_id = $2 AND ${VISIBLE_DOCUMENT}
       AND a.document_id BETWEEN $3 AND $4`,
    [scope.id, scope.organizationId, range.from, range.to],
  );
}
