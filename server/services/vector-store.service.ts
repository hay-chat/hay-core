/**
 * Vector Store Service
 *
 * This service provides vector embedding storage and similarity search using pgvector and LangChain.
 * It's designed as a plain TypeScript service that uses the shared DataSource.
 * If this codebase uses NestJS, this can be easily converted to an @Injectable() provider.
 *
 * @module services/vector-store
 */

import { TypeORMVectorStore } from "@langchain/community/vectorstores/typeorm";
import { OpenAIEmbeddings } from "@langchain/openai";
import { AppDataSource } from "../database/data-source";
import { config } from "../config/env";
import type { DataSourceOptions } from "typeorm";

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
  private vectorStore: TypeORMVectorStore | null = null;
  private embeddings: OpenAIEmbeddings;
  private readonly embeddingDim: number;
  private _initialized: boolean = false;

  constructor() {
    // Initialize OpenAI embeddings
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.openai.apiKey,
      modelName: config.openai.models.embedding.model || "text-embedding-3-small",
      dimensions: parseInt(process.env.EMBEDDING_DIM || "1536"),
    });

    this.embeddingDim = parseInt(process.env.EMBEDDING_DIM || "1536");
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

    // Get connection options from the initialized DataSource
    const postgresConnectionOptions: DataSourceOptions = {
      type: "postgres",
      host: config.database.host,
      port: config.database.port,
      username: config.database.username,
      password: config.database.password,
      database: config.database.database,
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    };

    this.vectorStore = await TypeORMVectorStore.fromDataSource(this.embeddings, {
      postgresConnectionOptions,
      tableName: "embeddings",
    });

    this._initialized = true;
  }

  /**
   * Add text chunks to the vector store
   *
   * @param orgId - Organization ID for multi-tenancy
   * @param docId - Optional document ID for linking embeddings to documents
   * @param chunks - Array of text chunks with optional metadata
   * @returns Array of embedding IDs
   */
  async addChunks(orgId: string, docId: string | null, chunks: VectorChunk[]): Promise<string[]> {
    if (!this.embeddings) {
      throw new Error("Embeddings not initialized.");
    }

    // Embed all chunks
    const texts = chunks.map((chunk) => chunk.content);
    const vectors = await this.embeddings.embedDocuments(texts);

    // Insert directly using raw SQL to handle our custom columns properly
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
        orgId,
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
   * @param orgId - Organization ID to filter results
   * @param query - Search query text
   * @param k - Number of results to return (default: 10)
   * @returns Array of search results with similarity scores
   */
  async search(orgId: string, query: string, k: number = 10): Promise<SearchResult[]> {
    if (!this.vectorStore) {
      throw new Error("VectorStore not initialized. Call initialize() first.");
    }

    // First, embed the query
    const queryVector = await this.embeddings.embedQuery(query);

    // Use raw SQL for organization-scoped similarity search
    // This ensures proper multi-tenancy filtering
    // Cast the embedding column to vector type for the comparison
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
      orgId,
      k,
    ]);

    // console.log("🚨 [VectorStoreService] ROW Search results", results);

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
   * @param orgId - Organization ID for additional security
   * @param docId - Document ID whose embeddings should be deleted
   * @returns Number of deleted embeddings
   */
  async deleteByDocumentId(orgId: string, docId: string): Promise<number> {
    const result = await AppDataSource.query(
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
   * @returns Number of deleted embeddings
   */
  async deleteByOrganizationId(orgId: string): Promise<number> {
    const result = await AppDataSource.query(
      `DELETE FROM embeddings WHERE "organization_id" = $1`,
      [orgId],
    );

    return result[1]; // Returns affected row count
  }

  /**
   * Get embedding statistics for an organization
   *
   * @param orgId - Organization ID
   * @returns Statistics object
   */
  async getStatistics(orgId: string): Promise<{
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
      [orgId],
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
