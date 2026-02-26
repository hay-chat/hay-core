import { AppDataSource } from "@server/database/data-source";
import { Document, DocumentationStatus } from "@server/entities/document.entity";
import { documentRepository } from "@server/repositories/document.repository";
import { documentProcessorService } from "./document-processor.service";
import { websocketService } from "./websocket.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("document-retry");

interface RetryQueueResult {
  processed: number;
  succeeded: number;
  failed: number;
  details: Array<{
    documentId: string;
    url: string;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Service for retrying failed document processing with exponential backoff
 */
export class DocumentRetryService {
  private readonly MAX_RETRY_COUNT = 3;
  private readonly MAX_BATCH_SIZE = 100; // Process at most 10 documents per retry run

  /**
   * Calculate the minimum wait time based on retry count (exponential backoff)
   * Formula: 5 * 2^retryCount minutes
   * - Retry 0 → 1: 5 minutes
   * - Retry 1 → 2: 10 minutes
   * - Retry 2 → 3: 20 minutes
   */
  private calculateBackoffTime(retryCount: number): number {
    const minutes = 5 * Math.pow(2, retryCount);
    return minutes * 60 * 1000; // Convert to milliseconds
  }

  /**
   * Find documents that need retry processing
   * Returns documents with status PROCESSING that haven't exceeded max retries
   * and have waited long enough based on exponential backoff
   */
  async findDocumentsToRetry(organizationId?: string): Promise<Document[]> {
    try {
      const repository = AppDataSource.getRepository(Document);

      // Build query to find documents that need retry
      const query = repository
        .createQueryBuilder("document")
        .where("document.status = :status", { status: DocumentationStatus.PROCESSING })
        .andWhere("COALESCE((document.processing_metadata->>'retryCount')::int, 0) < :maxRetries", {
          maxRetries: this.MAX_RETRY_COUNT,
        });

      // Filter by organization if specified
      if (organizationId) {
        query.andWhere("document.organization_id = :organizationId", { organizationId });
      }

      // Get all potentially eligible documents
      const documents = await query.getMany();

      // Filter by exponential backoff timing
      const now = new Date();
      const eligibleDocuments = documents.filter((doc) => {
        if (!doc.processingMetadata?.lastAttemptAt) {
          return true; // No last attempt, eligible for retry
        }

        const retryCount = doc.processingMetadata.retryCount || 0;
        const backoffTime = this.calculateBackoffTime(retryCount);
        const lastAttempt = new Date(doc.processingMetadata.lastAttemptAt);
        const timeSinceLastAttempt = now.getTime() - lastAttempt.getTime();

        return timeSinceLastAttempt >= backoffTime;
      });

      logger.info(
        { eligible: eligibleDocuments.length, total: documents.length },
        "Found documents eligible for retry",
      );

      return eligibleDocuments;
    } catch (error) {
      logger.error({ err: error }, "Error finding documents to retry");
      return [];
    }
  }

  /**
   * Retry processing a single document
   * Increments retry count and uses the document processor service
   */
  async retryDocument(documentId: string, organizationId: string): Promise<boolean> {
    try {
      // Fetch the document
      const document = await documentRepository.findByIdAndOrganization(documentId, organizationId);
      if (!document) {
        logger.error({ documentId }, "Document not found");
        return false;
      }

      // Check if document is eligible for retry
      const retryCount = document.processingMetadata?.retryCount || 0;
      if (retryCount >= this.MAX_RETRY_COUNT) {
        logger.warn(
          { documentId, retryCount },
          "Document has exceeded max retry count",
        );

        // Mark as ERROR if not already
        if (document.status !== DocumentationStatus.ERROR) {
          await documentRepository.update(documentId, organizationId, {
            status: DocumentationStatus.ERROR,
            processingMetadata: {
              ...document.processingMetadata,
              retryCount,
              lastAttemptAt: new Date(),
            },
          });

          // Notify via WebSocket
          websocketService.sendToOrganization(organizationId, {
            type: "document:status-updated",
            payload: {
              documentId,
              status: DocumentationStatus.ERROR,
            },
          });
        }

        return false;
      }

      // Check if we have the necessary data to retry
      if (!document.sourceUrl) {
        logger.error({ documentId }, "Document missing sourceUrl for retry");
        return false;
      }

      logger.info(
        { documentId, sourceUrl: document.sourceUrl, attempt: retryCount + 1, maxRetries: this.MAX_RETRY_COUNT },
        "Retrying document",
      );

      // TODO: We need to fetch the HTML content again since we don't store it
      // For now, we'll mark this as a limitation and skip documents that don't have cached HTML
      // In a production system, you would either:
      // 1. Store the raw HTML in the document
      // 2. Re-scrape the URL to get fresh HTML
      // 3. Use a caching layer like Redis to store HTML temporarily

      // For this implementation, we'll need to re-scrape the URL
      const { WebScraperService } = await import("./web-scraper.service");
      const scraper = new WebScraperService();

      const scrapedPages = await scraper.scrapeSelectedPages([
        {
          url: document.sourceUrl,
          title: document.title,
          selected: true,
          discoveredAt: new Date(),
        },
      ]);

      if (scrapedPages.length === 0) {
        logger.error({ sourceUrl: document.sourceUrl }, "Failed to scrape URL for retry");

        await documentRepository.update(documentId, organizationId, {
          processingMetadata: {
            ...document.processingMetadata,
            retryCount: retryCount + 1,
            lastError: "Failed to scrape URL for retry",
            lastAttemptAt: new Date(),
          },
        });

        return false;
      }

      const scrapedPage = scrapedPages[0];

      // Use the document processor service to retry processing
      const result = await documentProcessorService.processWebDocument({
        documentId,
        organizationId,
        pageUrl: document.sourceUrl,
        htmlContent: scrapedPage.html,
        pageTitle: document.title,
        metadata: {
          type: document.type,
          status: undefined, // Will default to PUBLISHED on success
          tags: document.tags,
          categories: document.categories,
        },
        retryCount: retryCount + 1,
        jobId: document.processingMetadata?.jobId,
      });

      // Emit WebSocket update
      if (result.success) {
        websocketService.sendToOrganization(organizationId, {
          type: "document:status-updated",
          payload: {
            documentId,
            status: result.document?.status || DocumentationStatus.PUBLISHED,
          },
        });
      }

      return result.success;
    } catch (error) {
      logger.error({ err: error, documentId }, "Error retrying document");
      return false;
    }
  }

  /**
   * Process all documents in the retry queue
   * This is called by the scheduled job
   */
  async processRetryQueue(): Promise<RetryQueueResult> {
    logger.info("Processing retry queue");

    const result: RetryQueueResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      details: [],
    };

    try {
      // Find all documents that need retry across all organizations
      const documents = await this.findDocumentsToRetry();

      if (documents.length === 0) {
        logger.info("No documents to retry");
        return result;
      }

      // Cap the batch to avoid overwhelming target servers with concurrent retries
      const batch = documents.slice(0, this.MAX_BATCH_SIZE);
      logger.info(
        { batchSize: batch.length, totalEligible: documents.length },
        "Processing eligible documents",
      );

      // Process each document in the batch
      for (const document of batch) {
        result.processed++;

        const success = await this.retryDocument(document.id, document.organizationId);

        if (success) {
          result.succeeded++;
        } else {
          result.failed++;
        }

        result.details.push({
          documentId: document.id,
          url: document.sourceUrl || "unknown",
          success,
          error: success ? undefined : "Processing failed",
        });

        // Delay between retries to avoid rate limiting on target servers
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      logger.info(
        { succeeded: result.succeeded, failed: result.failed, processed: result.processed },
        "Retry queue processing completed",
      );

      return result;
    } catch (error) {
      logger.error({ err: error }, "Error processing retry queue");
      return result;
    }
  }

  /**
   * Manually trigger a retry for a specific document (called from API)
   * Resets retry count to allow immediate retry
   */
  async manualRetry(documentId: string, organizationId: string): Promise<boolean> {
    try {
      const document = await documentRepository.findByIdAndOrganization(documentId, organizationId);
      if (!document) {
        throw new Error("Document not found");
      }

      // Reset retry count and status to allow immediate retry
      await documentRepository.update(documentId, organizationId, {
        status: DocumentationStatus.PROCESSING,
        processingMetadata: {
          ...document.processingMetadata,
          retryCount: 0, // Reset to 0 for manual retry
          lastAttemptAt: new Date(0), // Set to epoch so it's immediately eligible
        },
      });

      logger.info({ documentId }, "Manual retry triggered for document");

      // Perform the retry immediately
      return await this.retryDocument(documentId, organizationId);
    } catch (error) {
      logger.error({ err: error, documentId }, "Error in manual retry");
      throw error;
    }
  }
}

export const documentRetryService = new DocumentRetryService();
