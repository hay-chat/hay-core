import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { DocumentProcessorFactory } from "@server/processors";
import { vectorStoreService } from "@server/services/vector-store.service";
import { documentRepository } from "@server/repositories/document.repository";
import { splitTextIntoChunks, createChunkMetadata } from "@server/utils/text-chunking";
import { sanitizeContent } from "@server/utils/sanitize";
import {
  DocumentationType,
  DocumentationStatus,
  DocumentVisibility,
  ImportMethod,
} from "@server/entities/document.entity";
import { documentListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";
import { WebScraperService, type DiscoveredPage } from "@server/services/web-scraper.service";
import { HtmlProcessor } from "@server/processors/html.processor";
import { jobRepository } from "@server/repositories/job.repository";
import { JobStatus, JobPriority } from "@server/entities/job.entity";
import { Document } from "@server/entities/document.entity";
import { jobQueueService } from "@server/services/job-queue.service";
import { documentProcessorService } from "@server/services/document-processor.service";
import { documentRetryService } from "@server/services/document-retry.service";
import { storageService } from "@server/services/storage.service";

export const documentsRouter = t.router({
  list: createListProcedure(documentListInputSchema, documentRepository),
  getById: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const document = await documentRepository.findById(input.id);

      if (!document || document.organizationId !== ctx.organizationId) {
        throw new Error("Document not found");
      }

      return {
        id: document.id,
        title: document.title,
        description: document.description,
        content: document.content,
        type: document.type,
        status: document.status,
        visibility: document.visibility,
        tags: document.tags,
        categories: document.categories,
        sourceUrl: document.sourceUrl,
        importMethod: document.importMethod,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      };
    }),
  search: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .input(
      z.object({
        query: z.string(),
        limit: z.number().min(1).max(50).optional().default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Ensure vector store is initialized
      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }

      // Search using the vector store service
      const searchResults = await vectorStoreService.search(
        ctx.organizationId!,
        input.query,
        input.limit,
      );

      // Get document details for the search results
      const documentIds = [
        ...new Set(searchResults.map((r) => r.metadata?.documentId).filter(Boolean)),
      ];

      const documents =
        documentIds.length > 0
          ? (
              await Promise.all(documentIds.map((id) => documentRepository.findById(id as string)))
            ).filter((doc) => doc && doc.organizationId === ctx.organizationId)
          : [];

      // Map results with document details
      return searchResults.map((result) => {
        const doc = documents.find((d) => d?.id === result.metadata?.documentId);
        return {
          id: result.id,
          documentId: result.metadata?.documentId,
          title: doc?.title || "Untitled",
          content: result.content.substring(0, 200) + "...",
          similarity: result.similarity,
          type: doc?.type || DocumentationType.ARTICLE,
          status: doc?.status || DocumentationStatus.PUBLISHED,
          metadata: result.metadata,
        };
      });
    }),
  create: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.CREATE)
    .input(
      z.object({
        title: z.string(),
        content: z.string(),
        fileBuffer: z.string().optional(), // Base64 encoded file
        mimeType: z.string().optional(),
        fileName: z.string().optional(),
        type: z.nativeEnum(DocumentationType).optional(),
        status: z.nativeEnum(DocumentationStatus).optional(),
        visibility: z.nativeEnum(DocumentVisibility).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new Error("Organization ID is required");
      }
      let processedContent = input.content;
      let metadata: Record<string, unknown> = {};
      let attachments:
        | Array<{ type: string; url: string; name: string; size?: number }>
        | undefined;

      // Process file if provided
      if (input.fileBuffer && input.mimeType) {
        const buffer = Buffer.from(input.fileBuffer, "base64");
        const processor = new DocumentProcessorFactory();
        const processed = await processor.processDocument(buffer, input.mimeType, input.fileName);
        processedContent = processed.content;
        metadata = processed.metadata;

        // Save the original file to storage
        try {
          const uploadResult = await storageService.upload({
            buffer,
            originalName: input.fileName || "document",
            mimeType: input.mimeType,
            folder: `documents/${ctx.organizationId}`,
            organizationId: ctx.organizationId,
            uploadedById: ctx.user.id,
          });

          attachments = [
            {
              type: input.mimeType,
              url: uploadResult.url,
              name: input.fileName || "document",
              size: buffer.length,
            },
          ];
        } catch (uploadError) {
          console.error("Failed to save document file to storage:", uploadError);
          // Continue without attachment - document content will still be processed
        }
      }

      // Sanitize content to remove null bytes before saving
      const sanitizedContent = sanitizeContent(processedContent);

      // Save document to database first
      const document = await documentRepository.create({
        title: sanitizeContent(input.title),
        content: sanitizedContent,
        type: input.type || DocumentationType.ARTICLE,
        status: input.status || DocumentationStatus.DRAFT,
        visibility: input.visibility || DocumentVisibility.PRIVATE,
        organizationId: ctx.organizationId,
        importMethod: input.fileBuffer ? ImportMethod.UPLOAD : ImportMethod.UPLOAD,
        attachments,
      });

      // Ensure vector store is initialized
      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }

      // Split content into chunks for better retrieval
      const chunks = splitTextIntoChunks(sanitizedContent, {
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      // Create metadata for each chunk
      const vectorChunks = chunks.map((content, index) => ({
        content,
        metadata: createChunkMetadata(index, chunks.length, {
          documentId: document.id,
          documentTitle: input.title,
          documentType: input.type || DocumentationType.ARTICLE,
          ...metadata,
        }),
      }));

      // Add chunks to vector store
      const embeddingIds = await vectorStoreService.addChunks(
        ctx.organizationId,
        document.id,
        vectorChunks,
      );

      return {
        id: document.id,
        title: document.title,
        embeddingsCreated: embeddingIds.length,
        chunksCreated: chunks.length,
        metadata: metadata,
      };
    }),
  update: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.UPDATE)
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        regenerateEmbeddings: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find existing document
      const document = await documentRepository.findById(input.id);
      if (!document || document.organizationId !== ctx.organizationId) {
        throw new Error("Document not found");
      }

      // Update document
      const updatedDocument = await documentRepository.update(document.id, ctx.organizationId!, {
        ...(input.title && { title: input.title }),
        ...(input.content && { content: input.content }),
      });

      if (!updatedDocument) {
        throw new Error("Failed to update document");
      }

      // Regenerate embeddings if content changed or explicitly requested
      if ((input.content && input.content !== document.content) || input.regenerateEmbeddings) {
        // Ensure vector store is initialized
        if (!vectorStoreService.initialized) {
          await vectorStoreService.initialize();
        }

        // Delete old embeddings
        await vectorStoreService.deleteByDocumentId(ctx.organizationId!, document.id);

        // Split new content into chunks
        const contentToEmbed = input.content || document.content || "";
        const chunks = splitTextIntoChunks(contentToEmbed, {
          chunkSize: 1000,
          chunkOverlap: 200,
        });

        // Create metadata for each chunk
        const vectorChunks = chunks.map((content, index) => ({
          content,
          metadata: createChunkMetadata(index, chunks.length, {
            documentId: document.id,
            documentTitle: input.title || document.title,
            documentType: document.type,
          }),
        }));

        // Add new chunks to vector store
        const embeddingIds = await vectorStoreService.addChunks(
          ctx.organizationId!,
          document.id,
          vectorChunks,
        );

        return {
          id: updatedDocument.id,
          title: updatedDocument.title,
          embeddingsRegenerated: true,
          embeddingsCreated: embeddingIds.length,
          chunksCreated: chunks.length,
        };
      }

      return {
        id: updatedDocument.id,
        title: updatedDocument.title,
        embeddingsRegenerated: false,
      };
    }),
  delete: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.DELETE)
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find existing document
      const document = await documentRepository.findById(input.id);
      if (!document || document.organizationId !== ctx.organizationId) {
        throw new Error("Document not found");
      }

      // Ensure vector store is initialized
      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }

      // Delete embeddings associated with the document
      const deletedEmbeddings = await vectorStoreService.deleteByDocumentId(
        ctx.organizationId!,
        document.id,
      );

      // Delete the document itself
      await documentRepository.delete(document.id, ctx.organizationId!);

      return {
        success: true,
        deletedEmbeddings,
        message: `Document and ${deletedEmbeddings} embeddings deleted successfully`,
      };
    }),

  regenerateEmbeddings: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.UPDATE)
    .input(
      z.object({
        documentId: z.string().optional(),
        chunkSize: z.number().optional().default(1000),
        chunkOverlap: z.number().optional().default(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure vector store is initialized
      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }

      // If documentId is provided, regenerate for single document
      if (input.documentId) {
        const document = await documentRepository.findById(input.documentId);
        if (!document || document.organizationId !== ctx.organizationId) {
          throw new Error("Document not found");
        }

        // Delete old embeddings
        await vectorStoreService.deleteByDocumentId(ctx.organizationId!, document.id);

        // Split content into chunks
        const chunks = splitTextIntoChunks(document.content || "", {
          chunkSize: input.chunkSize,
          chunkOverlap: input.chunkOverlap,
        });

        // Create metadata for each chunk
        const vectorChunks = chunks.map((content, index) => ({
          content,
          metadata: createChunkMetadata(index, chunks.length, {
            documentId: document.id,
            documentTitle: document.title,
            documentType: document.type,
          }),
        }));

        // Add new chunks to vector store
        const embeddingIds = await vectorStoreService.addChunks(
          ctx.organizationId!,
          document.id,
          vectorChunks,
        );

        return {
          documentsProcessed: 1,
          embeddingsCreated: embeddingIds.length,
          chunksCreated: chunks.length,
        };
      }

      // Regenerate for all documents in organization
      const documents = await documentRepository.findByOrganization(ctx.organizationId!);
      let totalEmbeddings = 0;
      let totalChunks = 0;

      for (const document of documents) {
        // Delete old embeddings
        await vectorStoreService.deleteByDocumentId(ctx.organizationId!, document.id);

        // Split content into chunks
        const chunks = splitTextIntoChunks(document.content || "", {
          chunkSize: input.chunkSize,
          chunkOverlap: input.chunkOverlap,
        });

        // Create metadata for each chunk
        const vectorChunks = chunks.map((content, index) => ({
          content,
          metadata: createChunkMetadata(index, chunks.length, {
            documentId: document.id,
            documentTitle: document.title,
            documentType: document.type,
          }),
        }));

        // Add new chunks to vector store
        const embeddingIds = await vectorStoreService.addChunks(
          ctx.organizationId!,
          document.id,
          vectorChunks,
        );

        totalEmbeddings += embeddingIds.length;
        totalChunks += chunks.length;
      }

      return {
        documentsProcessed: documents.length,
        embeddingsCreated: totalEmbeddings,
        chunksCreated: totalChunks,
      };
    }),

  getEmbeddingStats: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ).query(async ({ ctx }) => {
    // Ensure vector store is initialized
    if (!vectorStoreService.initialized) {
      await vectorStoreService.initialize();
    }

    const stats = await vectorStoreService.getStatistics(ctx.organizationId!);

    return stats;
  }),

  discoverWebPages: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.IMPORT)
    .input(
      z.object({
        url: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new Error("Organization ID is required");
      }

      // Create a job for page discovery
      const job = await jobRepository.create({
        title: `Discover pages from ${new URL(input.url).hostname}`,
        description: `Discovering documentation pages from ${input.url}`,
        status: JobStatus.QUEUED,
        priority: JobPriority.NORMAL,
        data: {
          type: "page_discovery",
          url: input.url,
          progress: {
            status: "starting",
            pagesFound: 0,
            pagesProcessed: 0,
            totalEstimated: 0,
            currentUrl: null,
            discoveredPages: [],
          },
        },
        organizationId: ctx.organizationId,
      });

      // Start the discovery process asynchronously
      processPageDiscovery(ctx.organizationId, job.id, input.url);

      return {
        jobId: job.id,
        message: "Page discovery started. Poll job status for progress.",
      };
    }),

  getDiscoveryJob: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .input(
      z.object({
        jobId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const job = await jobRepository.findById(input.jobId);

      if (!job || job.organizationId !== ctx.organizationId) {
        throw new Error("Job not found");
      }

      return {
        id: job.id,
        status: job.status,
        progress: job.data?.progress || null,
        result: job.result,
        error: job.result?.error || null,
      };
    }),

  cancelJob: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.UPDATE)
    .input(
      z.object({
        jobId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new Error("Organization ID is required");
      }

      const job = await jobQueueService.cancelJob(input.jobId, ctx.organizationId);

      if (!job) {
        throw new Error("Job not found or already completed");
      }

      return {
        success: true,
        jobId: job.id,
        status: job.status,
      };
    }),

  importFromWeb: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.IMPORT)
    .input(
      z.object({
        url: z.string().url(),
        pages: z.array(
          z.object({
            url: z.string(),
            title: z.string().optional(),
            description: z.string().optional(),
            selected: z.boolean(),
          }),
        ),
        metadata: z
          .object({
            type: z.nativeEnum(DocumentationType).optional(),
            status: z.nativeEnum(DocumentationStatus).optional(),
            visibility: z.nativeEnum(DocumentVisibility).optional(),
            tags: z.array(z.string()).optional(),
            categories: z.array(z.string()).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new Error("Organization ID is required");
      }

      // Filter selected pages and add discoveredAt
      const selectedPages = input.pages
        .filter((p) => p.selected)
        .map((p) => ({
          ...p,
          discoveredAt: new Date(),
        }));

      if (selectedPages.length === 0) {
        throw new Error("No pages selected for import");
      }

      // Create a job for web import
      const job = await jobRepository.create({
        title: `Import from ${new URL(input.url).hostname}`,
        description: `Importing ${selectedPages.length} pages from ${input.url}`,
        status: JobStatus.QUEUED,
        priority: JobPriority.NORMAL,
        data: {
          type: "web_import",
          url: input.url,
          pages: selectedPages,
          metadata: input.metadata,
        },
        organizationId: ctx.organizationId,
      });

      // Start the import process asynchronously
      processWebImport(ctx.organizationId, job.id, input.url, selectedPages as any, input.metadata);

      return {
        jobId: job.id,
        message: "Web import started. Check the job queue for progress.",
      };
    }),

  recrawl: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.UPDATE)
    .input(
      z.object({
        documentId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find the document
      const document = await documentRepository.findById(input.documentId);

      if (!document || document.organizationId !== ctx.organizationId) {
        throw new Error("Document not found");
      }

      if (!document.sourceUrl) {
        throw new Error("Document has no source URL to recrawl");
      }

      if (document.importMethod !== ImportMethod.WEB) {
        throw new Error("Only web-imported documents can be recrawled");
      }

      // Create a job for recrawling
      const job = await jobRepository.create({
        title: `Recrawl ${document.title}`,
        description: `Updating document from ${document.sourceUrl}`,
        status: JobStatus.QUEUED,
        priority: JobPriority.HIGH,
        data: {
          type: "web_recrawl",
          documentId: document.id,
          url: document.sourceUrl,
        },
        organizationId: ctx.organizationId!,
      });

      // Start the recrawl process asynchronously
      processWebRecrawl(ctx.organizationId!, job.id, document);

      return {
        jobId: job.id,
        message: "Recrawl started. Check the job queue for progress.",
      };
    }),

  getImporters: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ).query(async () => {
    // Get enabled plugins with document_importer capability
    // For now, return only the native web importer
    // TODO: Load plugins with document_importer capability

    return {
      native: [
        {
          id: "web",
          name: "Import from Website",
          description: "Crawl and import documentation from any website",
          icon: "globe",
          supportedFormats: ["html", "xhtml"],
        },
        {
          id: "upload",
          name: "Upload Files",
          description: "Upload documents from your computer",
          icon: "upload",
          supportedFormats: ["pdf", "txt", "md", "doc", "docx", "html", "json", "csv"],
        },
      ],
      plugins: [], // TODO: Load from plugin system
    };
  }),

  getDownloadUrl: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .input(
      z.object({
        documentId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const document = await documentRepository.findById(input.documentId);

      if (!document || document.organizationId !== ctx.organizationId) {
        throw new Error("Document not found");
      }

      // For web imports, return the source URL
      if (document.importMethod === ImportMethod.WEB && document.sourceUrl) {
        return {
          type: "web",
          url: document.sourceUrl,
          fileName: document.title,
        };
      }

      // For uploaded files, return the attachment URL
      if (document.attachments && document.attachments.length > 0) {
        const attachment = document.attachments[0];
        return {
          type: "file",
          url: attachment.url,
          fileName: attachment.name,
          mimeType: attachment.type,
          size: attachment.size,
        };
      }

      throw new Error("No downloadable file available for this document");
    }),

  retryDocument: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.UPDATE)
    .input(
      z.object({
        documentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new Error("Organization ID is required");
      }

      const success = await documentRetryService.manualRetry(input.documentId, ctx.organizationId);

      if (!success) {
        throw new Error("Failed to retry document processing");
      }

      return {
        success: true,
        message: "Document queued for retry",
      };
    }),
});

// Async function to process web import
async function processWebImport(
  organizationId: string,
  jobId: string,
  url: string,
  selectedPages: DiscoveredPage[],
  metadata?: Record<string, unknown>,
) {
  try {
    // Log received metadata for debugging
    console.log("[Web Import] Received metadata:", metadata);

    // Update job status to processing
    await jobQueueService.updateJobStatus(jobId, organizationId, {
      status: JobStatus.PROCESSING,
    });

    // Create placeholder documents immediately so users can see them
    const placeholderDocuments = [];
    for (const page of selectedPages) {
      const doc = await documentRepository.create({
        title: page.title || new URL(page.url).pathname,
        content: `Processing content from ${page.url}...`,
        type: (metadata?.type as DocumentationType) || DocumentationType.ARTICLE,
        status: DocumentationStatus.PROCESSING, // Mark as processing
        visibility: (metadata?.visibility as DocumentVisibility) || DocumentVisibility.PRIVATE,
        tags: metadata?.tags as string[] | undefined,
        categories: metadata?.categories as string[] | undefined,
        importMethod: ImportMethod.WEB,
        sourceUrl: page.url,
        organizationId,
        processingMetadata: {
          retryCount: 0,
          lastAttemptAt: new Date(),
          jobId,
          processingStage: "scraping",
        },
      });
      placeholderDocuments.push(doc);
    }

    console.log(`Created ${placeholderDocuments.length} placeholder documents`);

    // Initialize scraper
    const scraper = new WebScraperService();
    const htmlProcessor = new HtmlProcessor();

    // Track progress
    scraper.on("progress", async (progress) => {
      await jobQueueService.updateJobProgress(jobId, organizationId, {
        ...progress,
        totalPages: selectedPages.length, // Use actual selected page count
      });
    });

    // Scrape only the selected pages
    const pages = await scraper.scrapeSelectedPages(selectedPages);

    if (pages.length === 0) {
      throw new Error("No pages found to import");
    }

    // Process each page and update documents with error tracking
    const documents = [];
    const failedPages: Array<{ url: string; error: string }> = [];
    const successfulPages: string[] = [];

    for (let i = 0; i < pages.length; i++) {
      // Check if job was cancelled
      const currentJob = await jobRepository.findById(jobId);
      if (currentJob?.status === JobStatus.CANCELLED) {
        console.log(`[Web Import] Job ${jobId} was cancelled, stopping processing`);
        break;
      }

      const page = pages[i];

      try {
        // Find the corresponding placeholder document
        const placeholderDoc = placeholderDocuments.find((d) => d.sourceUrl === page.url);
        if (!placeholderDoc) {
          console.error(`No placeholder document found for ${page.url}`);
          failedPages.push({ url: page.url, error: "Placeholder document not found" });
          continue;
        }

        // Update progress for current page
        await jobQueueService.updateJobProgress(jobId, organizationId, {
          processedPages: i,
          totalPages: pages.length,
          currentUrl: page.url,
          successfulPages: successfulPages.length,
          failedPages: failedPages.length,
        });

        // Process document using the document processor service
        const result = await documentProcessorService.processWebDocument({
          documentId: placeholderDoc.id,
          organizationId,
          pageUrl: page.url,
          htmlContent: page.html,
          pageTitle: page.title || placeholderDoc.title,
          metadata: {
            type: (metadata?.type as DocumentationType) || placeholderDoc.type,
            status: metadata?.status as DocumentationStatus,
            tags: metadata?.tags as string[] | undefined,
            categories: metadata?.categories as string[] | undefined,
          },
          retryCount: 0,
          jobId,
        });

        if (result.success && result.document) {
          documents.push(result.document);
          successfulPages.push(page.url);
        } else {
          // Processing failed, track the failure
          failedPages.push({
            url: page.url,
            error: result.error || "Unknown processing error",
          });
        }

        // Update progress after page completion
        await jobQueueService.updateJobProgress(jobId, organizationId, {
          processedPages: i + 1,
          totalPages: pages.length,
          currentUrl: page.url,
          successfulPages: successfulPages.length,
          failedPages: failedPages.length,
        });
      } catch (pageError) {
        const errorMessage = pageError instanceof Error ? pageError.message : "Unknown error";
        console.error(`Failed to process page ${page.url}:`, errorMessage);
        failedPages.push({ url: page.url, error: errorMessage });

        // Error is already tracked in document metadata by the processor service
        // Continue processing other pages instead of failing entire job
        continue;
      }
    }

    // Update job as completed (even if some pages failed)
    const jobResult = {
      documentsCreated: documents.length,
      documentIds: documents.map((d) => d.id),
      successfulPages: successfulPages.length,
      failedPages: failedPages.length,
      totalPages: selectedPages.length,
      failures: failedPages.length > 0 ? failedPages : undefined,
      status: failedPages.length > 0 ? "completed_with_errors" : "completed",
    };

    await jobQueueService.completeJob(jobId, organizationId, jobResult);
  } catch (error) {
    console.error("Web import error:", error);

    // Update job as failed
    await jobQueueService.failJob(
      jobId,
      organizationId,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

// Async function to process page discovery
async function processPageDiscovery(organizationId: string, jobId: string, url: string) {
  try {
    // Update job status to processing
    await jobQueueService.updateJobStatus(jobId, organizationId, {
      status: JobStatus.PROCESSING,
      data: {
        type: "page_discovery",
        url,
        progress: {
          status: "discovering",
          pagesFound: 0,
          pagesProcessed: 0,
          totalEstimated: 0,
          currentUrl: url,
          discoveredPages: [],
        },
      },
    });

    // Initialize scraper
    const scraper = new WebScraperService();
    let discoveredPages: DiscoveredPage[] = [];

    // Listen for discovery progress events
    scraper.on(
      "discovery-progress",
      async (progress: {
        status: string;
        found: number;
        total?: number;
        currentUrl?: string;
        discoveredPages?: DiscoveredPage[];
      }) => {
        // Update discovered pages from event
        if (progress.discoveredPages) {
          discoveredPages = progress.discoveredPages;
        }

        // Update job with progress via job queue service (publishes to Redis)
        await jobQueueService.updateJobProgress(jobId, organizationId, {
          status: "discovering",
          pagesFound: progress.found,
          pagesProcessed: progress.discoveredPages?.length || 0, // Use actual discovered pages count
          totalEstimated: progress.total,
          currentUrl: progress.currentUrl,
          discoveredPages: discoveredPages,
        });
      },
    );

    // Discover URLs
    const pages = await scraper.discoverUrls(url);

    // Pages are already stored from progress events, update final result
    discoveredPages = pages;

    // Update job as completed with results
    await jobQueueService.completeJob(jobId, organizationId, {
      pages,
      totalFound: pages.length,
    });
  } catch (error) {
    console.error("Error in page discovery:", error);

    // Update job as failed
    await jobQueueService.failJob(
      jobId,
      organizationId,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

// Async function to process web recrawl
async function processWebRecrawl(organizationId: string, jobId: string, document: Document) {
  try {
    // Update job status to processing
    await jobQueueService.updateJobStatus(jobId, organizationId, {
      status: JobStatus.PROCESSING,
    });

    // Initialize scraper and processor
    const scraper = new WebScraperService();
    const htmlProcessor = new HtmlProcessor();

    // Scrape the single URL
    if (!document.sourceUrl) {
      throw new Error("Document has no source URL to recrawl");
    }
    const pages = await scraper.scrapeWebsite(document.sourceUrl);

    if (pages.length === 0) {
      throw new Error("Failed to recrawl the page");
    }

    const page = pages[0];

    // Convert HTML to markdown
    const processed = await htmlProcessor.process(Buffer.from(page.html), page.title);

    // Update document
    await documentRepository.update(document.id, organizationId, {
      content: processed.content,
      lastCrawledAt: new Date(),
    });

    // Regenerate embeddings
    if (!vectorStoreService.initialized) {
      await vectorStoreService.initialize();
    }

    // Delete old embeddings
    await vectorStoreService.deleteByDocumentId(organizationId, document.id);

    // Create new embeddings
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
        sourceUrl: document.sourceUrl,
      }),
    }));

    const embeddingIds = await vectorStoreService.addChunks(
      organizationId,
      document.id,
      vectorChunks,
    );

    // Update job as completed
    await jobQueueService.completeJob(jobId, organizationId, {
      documentId: document.id,
      embeddingsCreated: embeddingIds.length,
      chunksCreated: chunks.length,
    });
  } catch (error) {
    console.error("Recrawl error:", error);

    // Update job as failed
    await jobQueueService.failJob(
      jobId,
      organizationId,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}
