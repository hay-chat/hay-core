import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { DocumentProcessorFactory } from "@server/processors";
import { vectorStoreService } from "@server/services/vector-store.service";
import { documentRepository } from "@server/repositories/document.repository";
import {
  splitTextIntoChunks,
  createChunkMetadata,
} from "@server/utils/text-chunking";
import {
  DocumentationType,
  DocumentationStatus,
  DocumentVisibility,
} from "@server/entities/document.entity";
import { documentListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";

export const documentsRouter = t.router({
  list: createListProcedure(documentListInputSchema, documentRepository),
  search: authenticatedProcedure
    .input(
      z.object({
        query: z.string(),
        limit: z.number().min(1).max(50).optional().default(10),
      })
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
        input.limit
      );

      // Get document details for the search results
      const documentIds = [
        ...new Set(
          searchResults.map((r) => r.metadata?.documentId).filter(Boolean)
        ),
      ];

      const documents =
        documentIds.length > 0
          ? await Promise.all(
              documentIds.map((id) =>
                documentRepository.findById(id, ctx.organizationId!)
              )
            )
          : [];

      // Map results with document details
      return searchResults.map((result) => {
        const doc = documents.find(
          (d) => d?.id === result.metadata?.documentId
        );
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new Error("Organization ID is required");
      }
      let processedContent = input.content;
      let metadata: any = {};

      // Process file if provided
      if (input.fileBuffer && input.mimeType) {
        const buffer = Buffer.from(input.fileBuffer, "base64");
        const processor = new DocumentProcessorFactory();
        const processed = await processor.processDocument(
          buffer,
          input.mimeType,
          input.fileName
        );
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
        vectorChunks
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Find existing document
      const document = await documentRepository.findById(
        input.id,
        ctx.organizationId!
      );
      if (!document) {
        throw new Error("Document not found");
      }

      // Update document
      const updatedDocument = await documentRepository.update(
        document.id,
        ctx.organizationId!,
        {
          ...(input.title && { title: input.title }),
          ...(input.content && { content: input.content }),
        }
      );

      if (!updatedDocument) {
        throw new Error("Failed to update document");
      }

      // Regenerate embeddings if content changed or explicitly requested
      if (
        (input.content && input.content !== document.content) ||
        input.regenerateEmbeddings
      ) {
        // Ensure vector store is initialized
        if (!vectorStoreService.initialized) {
          await vectorStoreService.initialize();
        }

        // Delete old embeddings
        await vectorStoreService.deleteByDocumentId(
          ctx.organizationId!,
          document.id
        );

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
          vectorChunks
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Find existing document
      const document = await documentRepository.findById(
        input.id,
        ctx.organizationId!
      );
      if (!document) {
        throw new Error("Document not found");
      }

      // Ensure vector store is initialized
      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }

      // Delete embeddings associated with the document
      const deletedEmbeddings = await vectorStoreService.deleteByDocumentId(
        ctx.organizationId!,
        document.id
      );

      // Delete the document itself
      const deleted = await documentRepository.delete(
        document.id,
        ctx.organizationId!
      );

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
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure vector store is initialized
      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }

      // If documentId is provided, regenerate for single document
      if (input.documentId) {
        const document = await documentRepository.findById(
          input.documentId,
          ctx.organizationId!
        );
        if (!document) {
          throw new Error("Document not found");
        }

        // Delete old embeddings
        await vectorStoreService.deleteByDocumentId(
          ctx.organizationId!,
          document.id
        );

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
          vectorChunks
        );

        return {
          documentsProcessed: 1,
          embeddingsCreated: embeddingIds.length,
          chunksCreated: chunks.length,
        };
      }

      // Regenerate for all documents in organization
      const documents = await documentRepository.findByOrganization(
        ctx.organizationId!
      );
      let totalEmbeddings = 0;
      let totalChunks = 0;

      for (const document of documents) {
        // Delete old embeddings
        await vectorStoreService.deleteByDocumentId(
          ctx.organizationId!,
          document.id
        );

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
          vectorChunks
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
});
