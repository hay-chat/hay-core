/**
 * Document Summary Service
 *
 * Generates 1-2 sentence summaries for documents using the "easy" model tier.
 * Summaries are stored in the document.description field.
 *
 * This is a reusable hay-core feature — triggered on document import
 * and also callable on-demand for batch summarization.
 *
 * @module services/document-summary
 */

import { documentRepository } from "@server/repositories/document.repository";
import { LLMService } from "@server/services/core/llm.service";
import { Document } from "@server/entities/document.entity";
import { createLogger } from "@server/lib/logger";
import { IsNull, type FindOptionsWhere } from "typeorm";
import { AppDataSource } from "@server/database/data-source";

const logger = createLogger("document-summary");

const MAX_CONCURRENCY = 5;

class DocumentSummaryService {
  private llm: LLMService;

  constructor() {
    this.llm = new LLMService();
  }

  /**
   * Summarize a single document. Stores the result in document.description.
   * Skips if document already has a description (unless force=true).
   */
  async summarizeDocument(
    document: Document,
    options?: { force?: boolean },
  ): Promise<string | null> {
    if (document.description && !options?.force) {
      return document.description;
    }

    const content = document.content || "";
    if (!content.trim()) {
      logger.warn({ documentId: document.id }, "Skipping summary — empty content");
      return null;
    }

    try {
      const prompt = `Summarize this document in 1-2 sentences. Capture what the document covers and what questions it answers. Be specific — mention actual product features, processes, or topics.

Title: ${document.title || "Untitled"}
Content:
${content}`;

      const schema = {
        type: "object" as const,
        properties: {
          summary: {
            type: "string" as const,
            description: "1-2 sentence summary of what this document covers",
          },
        },
        required: ["summary"] as const,
        additionalProperties: false,
      };

      const responseText = await this.llm.invoke({
        prompt,
        jsonSchema: schema,
        tier: "easy",
        temperature: 0.3,
        max_tokens: 200,
      });

      const response = JSON.parse(responseText as string);
      const summary = response.summary;

      // Persist to document.description
      await documentRepository.update(document.id, document.organizationId, {
        description: summary,
      });

      return summary;
    } catch (error) {
      logger.error(
        { documentId: document.id, error: error instanceof Error ? error.message : error },
        "Failed to summarize document",
      );
      return null;
    }
  }

  /**
   * Summarize all documents in an organization that lack a description.
   * Runs with bounded concurrency.
   */
  async summarizeAllForOrg(
    organizationId: string,
    options?: { force?: boolean },
  ): Promise<{ summarized: number; skipped: number; failed: number }> {
    const documents = options?.force
      ? await documentRepository.findByOrganization(organizationId)
      : await this.findWithoutDescription(organizationId);

    if (documents.length === 0) {
      return { summarized: 0, skipped: 0, failed: 0 };
    }

    logger.info({ organizationId, count: documents.length }, "Starting batch summarization");

    let summarized = 0;
    let failed = 0;

    // Process with bounded concurrency
    for (let i = 0; i < documents.length; i += MAX_CONCURRENCY) {
      const batch = documents.slice(i, i + MAX_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((doc) => this.summarizeDocument(doc, options)),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          summarized++;
        } else {
          failed++;
        }
      }
    }

    const skipped = documents.length - summarized - failed;

    logger.info({ organizationId, summarized, skipped, failed }, "Batch summarization complete");

    return { summarized, skipped, failed };
  }

  /**
   * Find documents in an organization that have no description.
   */
  private async findWithoutDescription(organizationId: string): Promise<Document[]> {
    const repo = AppDataSource.getRepository(Document);
    return repo.find({
      where: {
        organizationId,
        description: IsNull(),
      } as FindOptionsWhere<Document>,
    });
  }
}

export const documentSummaryService = new DocumentSummaryService();
