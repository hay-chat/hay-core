/**
 * Vector Store Service
 *
 * This service provides vector embedding storage and similarity search using pgvector.
 * It calls the OpenAI embeddings API directly via the OpenAI SDK.
 *
 * @module services/vector-store
 */

import OpenAI from "openai";
import { AppDataSource } from "../database/data-source";
import { config } from "../config/env";
import type { EntityManager } from "typeorm";

const EMBEDDING_BATCH_SIZE = 100;

export interface VectorChunk {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  documentId: string;
  content: string;
  metadata?: Record<string, unknown>;
  similarity?: number;
}

export class VectorStoreService {
  private openai: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;
  private _initialized: boolean = false;

  constructor() {
    this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    this.model = config.openai.models.embedding.model || "text-embedding-3-small";
    this.dimensions = parseInt(process.env.EMBEDDING_DIM || "1536");
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Initialize the vector store
   * Must be called after DataSource is initialized
   */
  async initialize(): Promise<void> {
    if (!AppDataSource.isInitialized) {
      throw new Error("DataSource must be initialized before VectorStore");
    }

    this._initialized = true;
  }

  /**
   * Embed an array of texts, batching to stay within API limits.
   * Returns one vector per input text, in the same order.
   */
  private async embedTexts(texts: string[]): Promise<number[][]> {
    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      });

      // OpenAI returns embeddings sorted by index, but sort to be safe
      const sorted = response.data.sort((a, b) => a.index - b.index);
      allVectors.push(...sorted.map((item) => item.embedding));
    }

    return allVectors;
  }

  /**
   * Embed a single query string.
   */
  private async embedQuery(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });

    return response.data[0].embedding;
  }

  /**
   * Add text chunks to the vector store
   *
   * @param organizationId - Organization ID for multi-tenancy
   * @param docId - Optional document ID for linking embeddings to documents
   * @param chunks - Array of text chunks with optional metadata
   * @returns Array of embedding IDs
   */
  async addChunks(
    organizationId: string,
    docId: string | null,
    chunks: VectorChunk[],
  ): Promise<string[]> {
    const texts = chunks.map((chunk) => chunk.content);
    const vectors = await this.embedTexts(texts);

    const insertQuery = `
      INSERT INTO embeddings (
        "organization_id",
        "document_id",
        "page_content",
        metadata,
        embedding
      )
      VALUES ($1, $2, $3, $4, $5::vector)
      RETURNING id
    `;

    const ids: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const result = await AppDataSource.query(insertQuery, [
        organizationId,
        docId,
        chunks[i].content,
        chunks[i].metadata || {},
        `[${vectors[i].join(",")}]`,
      ]);

      ids.push(result[0].id);
    }

    return ids;
  }

  /**
   * Search for similar content filtered by organization
   *
   * @param organizationId - Organization ID to filter results
   * @param query - Search query text
   * @param k - Number of results to return (default: 10)
   * @returns Array of search results with similarity scores
   */
  async search(organizationId: string, query: string, k: number = 10): Promise<SearchResult[]> {
    if (!this._initialized) {
      throw new Error("VectorStore not initialized. Call initialize() first.");
    }

    const queryVector = await this.embedQuery(query);

    const searchQuery = `
      SELECT
        id,
        "page_content" as content,
        metadata,
        1 - (embedding::vector <=> $1::vector) as similarity
      FROM embeddings
      WHERE "organization_id" = $2
      ORDER BY embedding::vector <=> $1::vector
      LIMIT $3
    `;

    const results = await AppDataSource.query(searchQuery, [
      `[${queryVector.join(",")}]`,
      organizationId,
      k,
    ]);

    interface SearchResultRow {
      id: string;
      metadata: { documentId: string };
      content: string;
      similarity: number;
    }

    return results.map((row: SearchResultRow) => ({
      id: row.id,
      documentId: row.metadata.documentId,
      content: row.content,
      metadata: row.metadata,
      similarity: row.similarity,
    }));
  }

  /**
   * Delete embeddings by document ID
   *
   * @param organizationId - Organization ID for additional security
   * @param docId - Document ID whose embeddings should be deleted
   * @param manager - Optional transaction manager for atomic operations
   * @returns Number of deleted embeddings
   */
  async deleteByDocumentId(orgId: string, docId: string, manager?: EntityManager): Promise<number> {
    // Validate UUIDs
    const { validateUuid } = await import("../lib/validation/uuid");
    validateUuid(orgId, "organizationId");
    validateUuid(docId, "documentId");

    // Use transaction manager if provided, otherwise use AppDataSource
    const queryRunner = manager?.queryRunner || AppDataSource;

    const result = await queryRunner.query(
      `DELETE FROM embeddings WHERE "organization_id" = $1 AND "document_id" = $2`,
      [orgId, docId],
    );

    return result[1]; // Returns affected row count
  }

  /**
   * Delete embeddings by organization ID
   * Use with caution - this deletes all embeddings for an organization
   *
   * @param orgId - Organization ID whose embeddings should be deleted
   * @param manager - Optional transaction manager for atomic operations
   * @returns Number of deleted embeddings
   */
  async deleteByOrganizationId(orgId: string, manager?: EntityManager): Promise<number> {
    // Validate UUID
    const { validateUuid } = await import("../lib/validation/uuid");
    validateUuid(orgId, "organizationId");

    // Use transaction manager if provided, otherwise use AppDataSource
    const queryRunner = manager?.queryRunner || AppDataSource;

    const result = await queryRunner.query(`DELETE FROM embeddings WHERE "organization_id" = $1`, [
      orgId,
    ]);

    return result[1]; // Returns affected row count
  }

  /**
   * Delete embeddings by conversation IDs (GDPR erasure)
   * Searches for embeddings where metadata contains any of the given conversation IDs
   *
   * @param orgId - Organization ID for security filtering
   * @param conversationIds - Array of conversation IDs whose embeddings should be deleted
   * @param manager - Optional transaction manager for atomic operations
   * @returns Number of deleted embeddings
   */
  async deleteByConversationIds(
    orgId: string,
    conversationIds: string[],
    manager?: EntityManager,
  ): Promise<number> {
    if (!conversationIds.length) {
      return 0;
    }

    // Validate UUIDs
    const { validateUuid, validateUuidArray } = await import("../lib/validation/uuid");
    validateUuid(orgId, "organizationId");
    const validIds = validateUuidArray(conversationIds, "conversationIds");

    if (!validIds.length) {
      return 0;
    }

    // Use transaction manager if provided, otherwise use AppDataSource
    const queryRunner = manager?.queryRunner || AppDataSource;

    const result = await queryRunner.query(
      `DELETE FROM embeddings
       WHERE "organization_id" = $1
       AND (metadata->>'conversationId')::uuid = ANY($2::uuid[])`,
      [orgId, validIds],
    );

    return result[1] || 0;
  }

  /**
   * Delete embeddings by message IDs (GDPR erasure)
   * Searches for embeddings where metadata contains any of the given message IDs
   *
   * @param orgId - Organization ID for security filtering
   * @param messageIds - Array of message IDs whose embeddings should be deleted
   * @param manager - Optional transaction manager for atomic operations
   * @returns Number of deleted embeddings
   */
  async deleteByMessageIds(
    orgId: string,
    messageIds: string[],
    manager?: EntityManager,
  ): Promise<number> {
    if (!messageIds.length) {
      return 0;
    }

    // Validate UUIDs
    const { validateUuid, validateUuidArray } = await import("../lib/validation/uuid");
    validateUuid(orgId, "organizationId");
    const validIds = validateUuidArray(messageIds, "messageIds");

    if (!validIds.length) {
      return 0;
    }

    // Use transaction manager if provided, otherwise use AppDataSource
    const queryRunner = manager?.queryRunner || AppDataSource;

    const result = await queryRunner.query(
      `DELETE FROM embeddings
       WHERE "organization_id" = $1
       AND (metadata->>'messageId')::uuid = ANY($2::uuid[])`,
      [orgId, validIds],
    );

    return result[1] || 0;
  }

  /**
   * Find embeddings by conversation IDs (for GDPR export)
   *
   * @param orgId - Organization ID for security filtering
   * @param conversationIds - Array of conversation IDs
   * @returns Array of embeddings with their metadata
   */
  async findByConversationIds(
    orgId: string,
    conversationIds: string[],
  ): Promise<
    Array<{ id: string; pageContent: string; metadata: Record<string, unknown>; createdAt?: Date }>
  > {
    if (!conversationIds.length) {
      return [];
    }

    const results = await AppDataSource.query(
      `SELECT id, page_content as "pageContent", metadata, created_at as "createdAt"
       FROM embeddings
       WHERE "organization_id" = $1
       AND (metadata->>'conversationId')::uuid = ANY($2::uuid[])`,
      [orgId, conversationIds],
    );

    return results || [];
  }

  /**
   * Find embeddings by message IDs (for GDPR export)
   *
   * @param orgId - Organization ID for security filtering
   * @param messageIds - Array of message IDs
   * @returns Array of embeddings with their metadata
   */
  async findByMessageIds(
    orgId: string,
    messageIds: string[],
  ): Promise<
    Array<{ id: string; pageContent: string; metadata: Record<string, unknown>; createdAt?: Date }>
  > {
    if (!messageIds.length) {
      return [];
    }

    const results = await AppDataSource.query(
      `SELECT id, page_content as "pageContent", metadata, created_at as "createdAt"
       FROM embeddings
       WHERE "organization_id" = $1
       AND (metadata->>'messageId')::uuid = ANY($2::uuid[])`,
      [orgId, messageIds],
    );

    return results || [];
  }

  /**
   * Get embedding statistics for an organization
   *
   * @param organizationId - Organization ID
   * @returns Statistics object
   */
  async getStatistics(organizationId: string): Promise<{
    totalEmbeddings: number;
    totalDocuments: number;
    avgEmbeddingsPerDocument: number;
  }> {
    const stats = await AppDataSource.query(
      `
      SELECT
        COUNT(*)::int as "totalEmbeddings",
        COUNT(DISTINCT "document_id")::int as "totalDocuments"
      FROM embeddings
      WHERE "organization_id" = $1
    `,
      [organizationId],
    );

    const result = stats[0];

    return {
      totalEmbeddings: result.totalEmbeddings || 0,
      totalDocuments: result.totalDocuments || 0,
      avgEmbeddingsPerDocument:
        result.totalDocuments > 0 ? Math.round(result.totalEmbeddings / result.totalDocuments) : 0,
    };
  }
}

// Export singleton instance
export const vectorStoreService = new VectorStoreService();
