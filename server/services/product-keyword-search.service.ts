/**
 * Product Keyword Search Service
 *
 * The keyword half of product search: finds what an embedding blurs, such as
 * exact product names, brands, model numbers and SKUs. Its ranking is fused
 * with the vector ranking by the caller.
 *
 * Reads `products.search_vector`, a generated tsvector column that exists only
 * once migration AddProductSearchVector has run. Before that the search throws;
 * callers must treat it as optional.
 *
 * @module services/product-keyword-search
 */

import { AppDataSource } from "../database/data-source";
import { ProductStatus } from "../entities/product.enums";

/** Enough for a product name plus a few attributes; bounds the query's cost. */
const MAX_TERMS = 16;

/**
 * The words of a query, lower-cased and de-duplicated. Letters and digits only,
 * so the result is safe to join into a tsquery and "WH-1000XM5" becomes the
 * same "wh" + "1000xm5" Postgres indexes. Single characters are dropped.
 */
export function keywordTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length > 1))].slice(0, MAX_TERMS);
}

/**
 * Whole whitespace-separated tokens, compared as they are with SKUs and
 * barcodes. Kept whole because the text parser splits "ab-1234" unpredictably.
 */
export function identifierTerms(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token.length > 2);
  return [...new Set(tokens)].slice(0, MAX_TERMS);
}

export class ProductKeywordSearchService {
  /**
   * Ids of an organization's active products that match the query's words,
   * best first: exact SKU or barcode matches, then products ordered by the
   * rarity of the query words they contain (a word in the title counts double).
   */
  async search(organizationId: string, query: string, k: number): Promise<string[]> {
    const [bySku, byText] = await Promise.all([
      this.searchIdentifiers(organizationId, identifierTerms(query), k),
      this.searchText(organizationId, keywordTerms(query), k),
    ]);
    return [...new Set([...bySku, ...byText])].slice(0, k);
  }

  private async searchIdentifiers(
    organizationId: string,
    identifiers: string[],
    k: number,
  ): Promise<string[]> {
    if (!identifiers.length) return [];
    const rows: Array<{ id: string }> = await AppDataSource.query(
      `SELECT DISTINCT p.id
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.organization_id = $1
          AND p.status = $2
          AND (lower(v.sku) = ANY($3::text[]) OR lower(v.barcode) = ANY($3::text[]))
        ORDER BY p.id
        LIMIT $4`,
      [organizationId, ProductStatus.ACTIVE, identifiers, k],
    );
    return rows.map((row) => row.id);
  }

  /**
   * Any word may match: the query is a sentence, not a list of required words.
   * Each matched word scores by its rarity in this catalog (inverse document
   * frequency), and a word found in more than half the catalog ("for", "the",
   * or "shirt" in a shirt shop) is ignored: it tells products apart too little
   * to be worth a place in the ranking.
   */
  private async searchText(organizationId: string, terms: string[], k: number): Promise<string[]> {
    if (!terms.length) return [];
    const rows: Array<{ id: string }> = await AppDataSource.query(
      `WITH catalog AS (
         SELECT count(*)::float AS size
           FROM products
          WHERE organization_id = $1 AND status = $2
       ),
       hits AS (
         SELECT p.id,
                t.term,
                CASE WHEN p.search_vector @@ to_tsquery('simple', t.term || ':A')
                     THEN 2 ELSE 1 END AS weight
           FROM products p
           JOIN unnest($4::text[]) AS t(term)
             ON p.search_vector @@ to_tsquery('simple', t.term)
          WHERE p.organization_id = $1
            AND p.status = $2
            AND p.search_vector @@ to_tsquery('simple', $3)
       ),
       rarity AS (
         SELECT h.term, ln(c.size / count(*)) AS idf
           FROM hits h CROSS JOIN catalog c
          GROUP BY h.term, c.size
         HAVING count(*) * 2 <= c.size
       )
       SELECT h.id
         FROM hits h
         JOIN rarity r ON r.term = h.term
        GROUP BY h.id
        ORDER BY sum(r.idf * h.weight) DESC, h.id
        LIMIT $5`,
      [organizationId, ProductStatus.ACTIVE, terms.join(" | "), terms, k],
    );
    return rows.map((row) => row.id);
  }
}

export const productKeywordSearchService = new ProductKeywordSearchService();
