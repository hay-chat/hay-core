import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { DocumentProcessorFactory } from "@server/processors";
import { vectorStoreService } from "@server/services/vector-store.service";
import { documentRepository } from "@server/repositories/document.repository";
import { splitTextIntoChunks, createChunkMetadata } from "@server/utils/text-chunking";
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

export const documentsRouter = t.router({
  list: createListProcedure(documentListInputSchema, documentRepository),
  search: authenticatedProcedure
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
          ? (await Promise.all(documentIds.map((id) => documentRepository.findById(id as string)))).filter(
              (doc) => doc && doc.organizationId === ctx.organizationId,
            )
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
  create: authenticatedProcedure
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

      // Process file if provided
      if (input.fileBuffer && input.mimeType) {
        const buffer = Buffer.from(input.fileBuffer, "base64");
        const processor = new DocumentProcessorFactory();
        const processed = await processor.processDocument(buffer, input.mimeType, input.fileName);
        processedContent = processed.content;
        metadata = processed.metadata;
      }

      // Save document to database first
      const document = await documentRepository.create({
        title: input.title,
        content: processedContent,
        type: input.type || DocumentationType.ARTICLE,
        status: input.status || DocumentationStatus.DRAFT,
        visibility: input.visibility || DocumentVisibility.PRIVATE,
        organizationId: ctx.organizationId,
      });

      // Ensure vector store is initialized
      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }

      // Split content into chunks for better retrieval
      const chunks = splitTextIntoChunks(processedContent, {
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
  update: authenticatedProcedure
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
  delete: authenticatedProcedure
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

  regenerateEmbeddings: authenticatedProcedure
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

  getEmbeddingStats: authenticatedProcedure.query(async ({ ctx }) => {
    // Ensure vector store is initialized
    if (!vectorStoreService.initialized) {
      await vectorStoreService.initialize();
    }

    const stats = await vectorStoreService.getStatistics(ctx.organizationId!);

    return stats;
  }),

  discoverWebPages: authenticatedProcedure
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

  getDiscoveryJob: authenticatedProcedure
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

  importFromWeb: authenticatedProcedure
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

  recrawl: authenticatedProcedure
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

  getImporters: authenticatedProcedure.query(async () => {
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
    // Update job status to processing
    await jobRepository.update(jobId, organizationId, {
      status: JobStatus.PROCESSING,
    });

    // Initialize scraper
    const scraper = new WebScraperService();
    const htmlProcessor = new HtmlProcessor();

    // Track progress
    scraper.on("progress", async (progress) => {
      await jobRepository.update(jobId, organizationId, {
        data: {
          type: "web_import",
          url,
          pages: selectedPages,
          metadata,
          progress,
        },
      });
    });

    // Scrape only the selected pages
    const pages = await scraper.scrapeSelectedPages(selectedPages);

    if (pages.length === 0) {
      throw new Error("No pages found to import");
    }

    // Process each page and create documents
    const documents = [];
    for (const page of pages) {
      // Convert HTML to markdown
      const processed = await htmlProcessor.process(Buffer.from(page.html), page.title);

      // Create document
      const document = await documentRepository.create({
        title: page.title || (metadata?.title as string) || "Untitled",
        content: processed.content,
        type: (metadata?.type as DocumentationType) || DocumentationType.ARTICLE,
        status: (metadata?.status as DocumentationStatus) || DocumentationStatus.PUBLISHED,
        visibility: (metadata?.visibility as DocumentVisibility) || DocumentVisibility.PRIVATE,
        tags: metadata?.tags as string[] | undefined,
        categories: metadata?.categories as string[] | undefined,
        importMethod: ImportMethod.WEB,
        sourceUrl: page.url,
        lastCrawledAt: page.crawledAt,
        organizationId,
      });

      // Create embeddings
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
          sourceUrl: page.url,
        }),
      }));

      await vectorStoreService.addChunks(organizationId, document.id, vectorChunks);

      documents.push(document);
    }

    // Update job as completed
    await jobRepository.update(jobId, organizationId, {
      status: JobStatus.COMPLETED,
      result: {
        documentsCreated: documents.length,
        documentIds: documents.map((d) => d.id),
      },
    });
  } catch (error) {
    console.error("Web import error:", error);

    // Update job as failed
    await jobRepository.update(jobId, organizationId, {
      status: JobStatus.FAILED,
      result: {
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

// Async function to process page discovery
async function processPageDiscovery(organizationId: string, jobId: string, url: string) {
  try {
    // Update job status to processing
    await jobRepository.update(jobId, organizationId, {
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
    const discoveredPages: DiscoveredPage[] = [];

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
        // Update job with progress
        await jobRepository.update(jobId, organizationId, {
          data: {
            type: "page_discovery",
            url,
            progress: {
              status: "discovering",
              pagesFound: progress.found,
              pagesProcessed: 0, // No pages processed during discovery
              totalEstimated: progress.total,
              currentUrl: progress.currentUrl,
              discoveredPages: discoveredPages,
            },
          },
        });
      },
    );

    // Discover URLs
    const pages = await scraper.discoverUrls(url);

    // Store discovered pages
    discoveredPages.push(...pages);

    // Update job as completed with results
    await jobRepository.update(jobId, organizationId, {
      status: JobStatus.COMPLETED,
      data: {
        type: "page_discovery",
        url,
        progress: {
          status: "completed",
          pagesFound: pages.length,
          pagesProcessed: pages.length,
          totalEstimated: pages.length,
          currentUrl: null,
          discoveredPages: pages,
        },
      },
      result: {
        pages,
        totalFound: pages.length,
      },
    });
  } catch (error) {
    console.error("Error in page discovery:", error);

    // Update job as failed
    await jobRepository.update(jobId, organizationId, {
      status: JobStatus.FAILED,
      result: {
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

// Async function to process web recrawl
async function processWebRecrawl(organizationId: string, jobId: string, document: Document) {
  try {
    // Update job status to processing
    await jobRepository.update(jobId, organizationId, {
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
    await jobRepository.update(jobId, organizationId, {
      status: JobStatus.COMPLETED,
      result: {
        documentId: document.id,
        embeddingsCreated: embeddingIds.length,
        chunksCreated: chunks.length,
      },
    });
  } catch (error) {
    console.error("Recrawl error:", error);

    // Update job as failed
    await jobRepository.update(jobId, organizationId, {
      status: JobStatus.FAILED,
      result: {
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}
