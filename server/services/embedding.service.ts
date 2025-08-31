import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "@server/config/env";

export class EmbeddingService {
  private embeddings: OpenAIEmbeddings;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      apiKey: config.openai.apiKey,
      modelName: config.openai.models.embedding.model,
      batchSize: 512,
      stripNewLines: true,
    });
  }

  async createEmbedding(text: string): Promise<number[]> {
    const embedding = await this.embeddings.embedQuery(text);
    return embedding;
  }

  async createEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings = await this.embeddings.embedDocuments(texts);
    return embeddings;
  }

  async createDocumentEmbedding(content: string, metadata?: any) {
    const embedding = await this.createEmbedding(content);

    return {
      embedding,
      metadata,
      contentLength: content.length,
      model: "text-embedding-3-small",
    };
  }
}

export const embeddingService = new EmbeddingService();
