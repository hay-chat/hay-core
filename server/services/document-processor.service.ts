import { HtmlProcessor } from "@server/processors/html.processor";
import { vectorStoreService } from "./vector-store.service";
import { headlessBrowserService } from "./headless-browser.service";
import { documentRepository } from "@server/repositories/document.repository";
import { splitTextIntoChunks, createChunkMetadata } from "@server/utils/text-chunking";
import { isExtractionPoor } from "@server/utils/extraction-quality";
import { DocumentationStatus, DocumentationType } from "@server/entities/document.entity";
import type { Document } from "@server/entities/document.entity";
import { documentSummaryService } from "./document-summary.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("document-processor");

export interface ProcessWebDocumentOptions {
  documentId: string;
  organizationId: string;
  pageUrl: string;
  htmlContent: string;
  pageTitle: string;
  metadata?: {
    type?: DocumentationType;
    status?: DocumentationStatus;
    tags?: string[];
    categories?: string[];
  };
  retryCount?: number;
  jobId?: string;
}

export interface ProcessWebDocumentResult {
  success: boolean;
  document?: Document;
  error?: string;
  stage?: "html_to_markdown" | "embedding";
}

/**
 * Service for processing web documents with retry logic and error tracking
 */
export class DocumentProcessorService {
  private htmlProcessor: HtmlProcessor;

  constructor() {
    this.htmlProcessor = new HtmlProcessor();
  }

  /**
   * Process a web document: convert HTML to Markdown, update content, and create embeddings
   */
  async processWebDocument(options: ProcessWebDocumentOptions): Promise<ProcessWebDocumentResult> {
    const {
      documentId,
      organizationId,
      pageUrl,
      htmlContent,
      pageTitle,
      metadata = {},
      retryCount = 0,
      jobId,
    } = options;

    try {
      // Step 1: Convert HTML to Markdown (using Readability + Turndown, synchronous)
      let processed: { content: string; metadata: Record<string, unknown> };
      try {
        processed = await this.htmlProcessor.process(Buffer.from(htmlContent), pageTitle);
      } catch (htmlError) {
        const errorMessage =
          htmlError instanceof Error ? htmlError.message : "HTML processing failed";
        logger.error({ pageUrl, error: errorMessage }, "HTML processing failed");

        // Update document with processing error
        await this.updateDocumentWithError(
          documentId,
          organizationId,
          pageUrl,
          errorMessage,
          "html_to_markdown",
          retryCount,
          jobId,
        );

        return {
          success: false,
          error: errorMessage,
          stage: "html_to_markdown",
        };
      }

      // Step 1b: Check extraction quality — fallback to headless browser if poor
      if (isExtractionPoor(processed.content, htmlContent)) {
        logger.info(
          { pageUrl, contentLength: processed.content.length, htmlLength: htmlContent.length },
          "Poor extraction detected, attempting headless browser fallback",
        );

        try {
          const renderedHtml = await headlessBrowserService.renderPage(pageUrl);
          const reprocessed = await this.htmlProcessor.process(
            Buffer.from(renderedHtml),
            pageTitle,
          );

          if (!isExtractionPoor(reprocessed.content, renderedHtml)) {
            processed = {
              content: reprocessed.content,
              metadata: {
                ...reprocessed.metadata,
                processingMethod: "readability-turndown-puppeteer",
              },
            };
            logger.info({ pageUrl }, "Headless browser fallback produced better content");
          } else {
            logger.warn(
              { pageUrl },
              "Headless browser fallback still produced poor content, using best available",
            );
            // Use whichever result is longer
            if (reprocessed.content.length > processed.content.length) {
              processed = {
                content: reprocessed.content,
                metadata: {
                  ...reprocessed.metadata,
                  processingMethod: "readability-turndown-puppeteer",
                },
              };
            }
          }
        } catch (fallbackError) {
          logger.warn(
            { pageUrl, err: fallbackError },
            "Headless browser fallback failed, proceeding with basic extraction",
          );
        }
      }

      // Step 2: Update document with processed content
      let document: Document | null;
      try {
        document = await documentRepository.update(documentId, organizationId, {
          title: pageTitle,
          content: processed.content,
          type: metadata.type,
          status: retryCount >= 3 ? DocumentationStatus.ERROR : DocumentationStatus.PROCESSING,
          tags: metadata.tags,
          categories: metadata.categories,
          lastCrawledAt: new Date(),
          processingMetadata: {
            retryCount,
            lastAttemptAt: new Date(),
            jobId,
            processingStage: "embedding",
          },
        });

        if (!document) {
          throw new Error("Failed to update document in database");
        }
      } catch (updateError) {
        const errorMessage =
          updateError instanceof Error ? updateError.message : "Database update failed";
        logger.error({ documentId, error: errorMessage }, "Failed to update document");

        await this.updateDocumentWithError(
          documentId,
          organizationId,
          pageUrl,
          errorMessage,
          "html_to_markdown",
          retryCount,
          jobId,
        );

        return {
          success: false,
          error: errorMessage,
          stage: "html_to_markdown",
        };
      }

      // Step 3: Create embeddings with error handling
      try {
        if (!vectorStoreService.initialized) {
          await vectorStoreService.initialize();
        }

        const chunks = splitTextIntoChunks(processed.content, {
          chunkSize: 1000,
          chunkOverlap: 200,
        });

        const vectorChunks = chunks.map((content, index) => ({
          content,
          metadata: createChunkMetadata(index, chunks.length, {
            documentId: document.id,
            documentTitle: document.title,
            documentType: document.type,
            sourceUrl: pageUrl,
          }),
        }));

        await vectorStoreService.addChunks(organizationId, document.id, vectorChunks);

        // Success: Update document to final status
        const finalStatus = metadata.status || DocumentationStatus.PUBLISHED;
        const updatedDocument = await documentRepository.update(document.id, organizationId, {
          status: finalStatus,
          processingMetadata: {
            retryCount,
            lastAttemptAt: new Date(),
            jobId,
            processingStage: undefined, // Clear stage on success
          },
        });

        logger.info({ documentId, pageUrl }, "Successfully processed document");

        // Step 4: Generate summary (fire-and-forget, non-blocking)
        const docToSummarize = updatedDocument || document;
        if (docToSummarize && !docToSummarize.description) {
          documentSummaryService.summarizeDocument(docToSummarize).catch((err) => {
            logger.warn({ documentId, err }, "Failed to generate document summary");
          });
        }

        return {
          success: true,
          document: docToSummarize,
        };
      } catch (embeddingError) {
        const errorMessage =
          embeddingError instanceof Error ? embeddingError.message : "Embedding generation failed";
        logger.error({ pageUrl, error: errorMessage }, "Failed to create embeddings");

        // Document is saved but without embeddings
        await documentRepository.update(document.id, organizationId, {
          content: `${document.content}\n\n_Note: Vector embeddings failed to generate. Search may be limited for this document._`,
          status: retryCount >= 3 ? DocumentationStatus.ERROR : DocumentationStatus.PROCESSING,
          processingMetadata: {
            retryCount,
            lastError: errorMessage,
            lastAttemptAt: new Date(),
            jobId,
            processingStage: "embedding",
          },
        });

        return {
          success: false,
          error: errorMessage,
          stage: "embedding",
          document,
        };
      }
    } catch (unexpectedError) {
      const errorMessage =
        unexpectedError instanceof Error
          ? unexpectedError.message
          : "Unexpected error during processing";
      logger.error({ pageUrl, error: errorMessage }, "Unexpected error processing document");

      await this.updateDocumentWithError(
        documentId,
        organizationId,
        pageUrl,
        errorMessage,
        "html_to_markdown",
        retryCount,
        jobId,
      );

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update document with error information
   */
  private async updateDocumentWithError(
    documentId: string,
    organizationId: string,
    pageUrl: string,
    errorMessage: string,
    stage: "html_to_markdown" | "embedding",
    retryCount: number,
    jobId?: string,
  ): Promise<void> {
    const status = retryCount >= 3 ? DocumentationStatus.ERROR : DocumentationStatus.PROCESSING;
    const content =
      retryCount >= 3
        ? `Failed to import content from ${pageUrl} after ${retryCount} attempts.\n\nError: ${errorMessage}`
        : `Processing content from ${pageUrl}...\n\nLast error: ${errorMessage}`;

    try {
      await documentRepository.update(documentId, organizationId, {
        content,
        status,
        processingMetadata: {
          retryCount,
          lastError: errorMessage,
          lastAttemptAt: new Date(),
          jobId,
          processingStage: stage,
        },
      });
    } catch (updateError) {
      logger.error({ err: updateError, documentId }, "Failed to update document with error status");
    }
  }
}

export const documentProcessorService = new DocumentProcessorService();
