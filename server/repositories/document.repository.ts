import { AppDataSource } from "../database/data-source";
import { Document } from "../entities/document.entity";
import { formatEmbeddingForQuery, parseEmbeddingFromQuery } from "../database/pgvector-type";

export class DocumentRepository {
  private repository = AppDataSource.getRepository(Document);

  async create(data: Partial<Document>): Promise<Document> {
    const document = this.repository.create(data);
    return await this.repository.save(document);
  }

  async findById(id: string, organizationId: string): Promise<Document | null> {
    return await this.repository.findOne({
      where: { id, organizationId },
    });
  }

  async findByOrganization(organizationId: string): Promise<Document[]> {
    return await this.repository.find({
      where: { organizationId },
    });
  }

  async updateEmbedding(
    id: string,
    organizationId: string,
    embedding: number[],
    metadata: any
  ): Promise<Document | null> {
    // Use raw query for proper vector type handling
    const query = `
      UPDATE documents 
      SET 
        embedding = $1::vector,
        "embeddingMetadata" = $2::jsonb
      WHERE id = $3 AND "organizationId" = $4
      RETURNING *
    `;
    
    const embeddingString = formatEmbeddingForQuery(embedding);
    const embeddingMetadata = {
      ...metadata,
      createdAt: new Date(),
    };
    
    const result = await this.repository.query(query, [
      embeddingString,
      JSON.stringify(embeddingMetadata),
      id,
      organizationId,
    ]);
    
    if (result[0]) {
      result[0].embedding = parseEmbeddingFromQuery(result[0].embedding);
    }
    
    return result[0] || null;
  }

  async saveWithEmbedding(
    data: Partial<Document>,
    embedding: number[],
    embeddingMetadata: any
  ): Promise<Document> {
    const document = this.repository.create({
      ...data,
      embedding,
      embeddingMetadata: {
        ...embeddingMetadata,
        createdAt: new Date(),
      },
    });

    return await this.repository.save(document);
  }

  async findSimilar(
    embedding: number[],
    organizationId: string,
    limit: number = 10
  ): Promise<Document[]> {
    // Using cosine similarity for vector search
    // This requires pgvector extension in PostgreSQL
    const embeddingString = formatEmbeddingForQuery(embedding);
    
    const query = `
      SELECT *, 
        1 - (embedding <=> $1::vector) as similarity
      FROM documents 
      WHERE "organizationId" = $2 
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;

    const results = await this.repository.query(query, [
      embeddingString,
      organizationId,
      limit,
    ]);
    
    // Parse embeddings in results
    return results.map((result: any) => ({
      ...result,
      embedding: parseEmbeddingFromQuery(result.embedding)
    }));
  }
}

export const documentRepository = new DocumentRepository();
