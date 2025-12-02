import { AppDataSource } from "@server/database/data-source";
import { Document, DocumentationStatus } from "@server/entities/document.entity";
import { documentRepository } from "@server/repositories/document.repository";
import { documentProcessorService } from "./document-processor.service";
import { websocketService } from "./websocket.service";
import { MoreThan, LessThan, In } from "typeorm";

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
        .andWhere(
          "COALESCE((document.processing_metadata->>'retryCount')::int, 0) < :maxRetries",
          { maxRetries: this.MAX_RETRY_COUNT },
        );

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

      console.log(
        `[DocumentRetry] Found ${eligibleDocuments.length}/${documents.length} documents eligible for retry`,
      );

      return eligibleDocuments;
    } catch (error) {
      console.error("[DocumentRetry] Error finding documents to retry:", error);
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
        console.error(`[DocumentRetry] Document ${documentId} not found`);
        return false;
      }

      // Check if document is eligible for retry
      const retryCount = document.processingMetadata?.retryCount || 0;
      if (retryCount >= this.MAX_RETRY_COUNT) {
        console.warn(
          `[DocumentRetry] Document ${documentId} has exceeded max retry count (${retryCount})`,
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
        console.error(`[DocumentRetry] Document ${documentId} missing sourceUrl for retry`);
        return false;
      }

      console.log(
        `[DocumentRetry] Retrying document ${documentId} from ${document.sourceUrl} (attempt ${retryCount + 1}/${this.MAX_RETRY_COUNT})`,
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
        console.error(`[DocumentRetry] Failed to scrape ${document.sourceUrl} for retry`);

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
      console.error(`[DocumentRetry] Error retrying document ${documentId}:`, error);
      return false;
    }
  }

  /**
   * Process all documents in the retry queue
   * This is called by the scheduled job
   */
  async processRetryQueue(): Promise<RetryQueueResult> {
    console.log("[DocumentRetry] Processing retry queue...");

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
        console.log("[DocumentRetry] No documents to retry");
        return result;
      }

      console.log(`[DocumentRetry] Processing ${documents.length} documents...`);

      // Process each document
      for (const document of documents) {
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

        // Add a small delay between documents to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      console.log(
        `[DocumentRetry] Completed: ${result.succeeded} succeeded, ${result.failed} failed out of ${result.processed} total`,
      );

      return result;
    } catch (error) {
      console.error("[DocumentRetry] Error processing retry queue:", error);
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

      console.log(`[DocumentRetry] Manual retry triggered for document ${documentId}`);

      // Perform the retry immediately
      return await this.retryDocument(documentId, organizationId);
    } catch (error) {
      console.error(`[DocumentRetry] Error in manual retry for ${documentId}:`, error);
      throw error;
    }
  }
}

export const documentRetryService = new DocumentRetryService();
