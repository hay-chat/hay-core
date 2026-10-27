/**
 * Product Vector Store Service
 *
 * Mirrors VectorStoreService but operates on the dedicated product_embeddings
 * table so the product catalog can scale and be tuned independently of
 * documents. Embeddings are written/read via raw SQL because TypeORM has no
 * native pgvector type. Embeddings go through the org's managed embedding
 * provider, so an EU-only org's catalog is embedded on the EU endpoint.
 *
 * @module services/product-vector-store
 */

import type { EntityManager } from "typeorm";
import { AppDataSource } from "../database/data-source";
import { config } from "../config/env";
import { createLogger } from "@server/lib/logger";
import { llmProviderFactory } from "@server/services/llm/llm-provider.factory";
import { emitUsage } from "@server/services/llm/usage-sink";

const logger = createLogger("product-vector-store");

const EMBEDDING_BATCH_SIZE = 100;
const MAX_CHARS_PER_BATCH = 900_000;

export interface ProductVectorChunk {
  productId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ProductSearchResult {
  id: string;
  productId: string;
  content: string;
  metadata?: Record<string, unknown>;
  similarity: number;
}

export class ProductVectorStoreService {
  private readonly model: string;
  private readonly dimensions: number;
  private _initialized: boolean = false;

  constructor() {
    this.model = config.openai.models.embedding.model || "text-embedding-3-small";
    this.dimensions = parseInt(process.env.EMBEDDING_DIM || "1536");
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (!AppDataSource.isInitialized) {
      throw new Error("DataSource must be initialized before ProductVectorStore");
    }
    this._initialized = true;
  }

  /** Embed texts in order, batched, on the org's region; asserts the column dimension. */
  private async embed(organizationId: string, texts: string[]): Promise<number[][]> {
    const batches: string[][] = [];
    let currentBatch: string[] = [];
    let currentBatchChars = 0;

    for (const text of texts) {
      const wouldExceedChars = currentBatchChars + text.length > MAX_CHARS_PER_BATCH;
      const wouldExceedCount = currentBatch.length >= EMBEDDING_BATCH_SIZE;

      if ((wouldExceedChars || wouldExceedCount) && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchChars = 0;
      }

      currentBatch.push(text);
      currentBatchChars += text.length;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    const { embedding: provider, region } =
      await llmProviderFactory.forOrganization(organizationId);
    const allVectors: number[][] = [];

    for (const batch of batches) {
      const result = await provider.embed({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      });
      if (result.dimensions !== this.dimensions) {
        throw new Error(
          `Embedding dimension mismatch: provider returned ${result.dimensions}, expected ${this.dimensions}.`,
        );
      }
      emitUsage({
        kind: "embedding",
        usage: result.usage,
        model: result.model,
        provider: result.provider,
        organizationId,
        region,
      });
      allVectors.push(...result.embeddings);
    }

    return allVectors;
  }

  /**
   * Upsert product embeddings. One row per product (the canonical
   * `searchText` is embedded as a single vector — products are not chunked).
   * If a product already has an embedding it is replaced.
   */
  async upsertProductEmbeddings(
    organizationId: string,
    chunks: ProductVectorChunk[],
    manager?: EntityManager,
  ): Promise<string[]> {
    if (!chunks.length) return [];

    const texts = chunks.map((c) => c.content);
    const vectors = await this.embed(organizationId, texts);
    const runner = manager?.queryRunner || AppDataSource;

    const ids: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      // Replace any existing embedding for this product first (single row per product).
      await runner.query(
        `DELETE FROM product_embeddings WHERE "organization_id" = $1 AND "product_id" = $2`,
        [organizationId, chunks[i].productId],
      );

      const result = await runner.query(
        `INSERT INTO product_embeddings (
           "organization_id",
           "product_id",
           "page_content",
           metadata,
           embedding
         )
         VALUES ($1, $2, $3, $4, $5::vector)
         RETURNING id`,
        [
          organizationId,
          chunks[i].productId,
          chunks[i].content,
          chunks[i].metadata || {},
          `[${vectors[i].join(",")}]`,
        ],
      );

      ids.push(result[0].id);
    }

    logger.debug({ organizationId, count: chunks.length }, "Upserted product embeddings");

    return ids;
  }

  /**
   * Vector similarity search for products within an organization.
   * Returns one row per product with the best similarity score.
   */
  async search(
    organizationId: string,
    query: string,
    k: number = 10,
  ): Promise<ProductSearchResult[]> {
    if (!this._initialized) {
      throw new Error("ProductVectorStore not initialized. Call initialize() first.");
    }

    const [queryVector] = await this.embed(organizationId, [query]);
    const vectorParam = `[${queryVector.join(",")}]`;

    const searchQuery = `
      SELECT
        id,
        "product_id" AS "productId",
        "page_content" AS content,
        metadata,
        1 - (embedding <=> $1::vector) AS similarity
      FROM product_embeddings
      WHERE "organization_id" = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;

    const rows = await AppDataSource.query(searchQuery, [vectorParam, organizationId, k]);

    return rows.map(
      (row: {
        id: string;
        productId: string;
        content: string;
        metadata: Record<string, unknown> | null;
        similarity: string | number;
      }) => ({
        id: row.id,
        productId: row.productId,
        content: row.content,
        metadata: row.metadata ?? {},
        similarity: parseFloat(String(row.similarity)),
      }),
    );
  }

  async deleteByProductId(
    organizationId: string,
    productId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const { validateUuid } = await import("../lib/validation/uuid");
    validateUuid(organizationId, "organizationId");
    validateUuid(productId, "productId");

    const runner = manager?.queryRunner || AppDataSource;
    const result = await runner.query(
      `DELETE FROM product_embeddings WHERE "organization_id" = $1 AND "product_id" = $2`,
      [organizationId, productId],
    );
    return result[1] || 0;
  }

  async deleteByProductIds(
    organizationId: string,
    productIds: string[],
    manager?: EntityManager,
  ): Promise<number> {
    if (!productIds.length) return 0;
    const { validateUuid, validateUuidArray } = await import("../lib/validation/uuid");
    validateUuid(organizationId, "organizationId");
    const validIds = validateUuidArray(productIds, "productIds");
    if (!validIds.length) return 0;

    const runner = manager?.queryRunner || AppDataSource;
    const result = await runner.query(
      `DELETE FROM product_embeddings
       WHERE "organization_id" = $1
       AND "product_id" = ANY($2::uuid[])`,
      [organizationId, validIds],
    );
    return result[1] || 0;
  }

  async deleteByOrganizationId(organizationId: string, manager?: EntityManager): Promise<number> {
    const { validateUuid } = await import("../lib/validation/uuid");
    validateUuid(organizationId, "organizationId");
    const runner = manager?.queryRunner || AppDataSource;
    const result = await runner.query(
      `DELETE FROM product_embeddings WHERE "organization_id" = $1`,
      [organizationId],
    );
    return result[1] || 0;
  }

  async getStatistics(organizationId: string): Promise<{
    totalEmbeddings: number;
    totalProducts: number;
  }> {
    const stats = await AppDataSource.query(
      `SELECT COUNT(*)::int AS "totalEmbeddings",
              COUNT(DISTINCT "product_id")::int AS "totalProducts"
         FROM product_embeddings
         WHERE "organization_id" = $1`,
      [organizationId],
    );
    return {
      totalEmbeddings: stats[0].totalEmbeddings || 0,
      totalProducts: stats[0].totalProducts || 0,
    };
  }
}

export const productVectorStoreService = new ProductVectorStoreService();
