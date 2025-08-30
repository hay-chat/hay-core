import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { vectorStoreService } from "@server/services/vector-store.service";
import { embeddingService } from "@server/services/embedding.service";

const embedInput = z.object({
  documentId: z.string().uuid().nullable().optional(),
  content: z.string().min(1),
  metadata: z.record(z.any()).optional(),
  chunks: z.array(z.object({
    content: z.string().min(1),
    metadata: z.record(z.any()).optional()
  })).optional()
});

const searchInput = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(100).default(10)
});

export const embeddingsRouter = t.router({
  // Add document embeddings
  add: authenticatedProcedure
    .input(embedInput)
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      
      if (!organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization ID is required"
        });
      }

      try {
        // Initialize vector store if needed
        if (!vectorStoreService.initialized) {
          await vectorStoreService.initialize();
        }

        let chunks: Array<{ content: string; metadata?: any }> = [];
        
        if (input.chunks && input.chunks.length > 0) {
          // Use provided chunks
          chunks = input.chunks;
        } else {
          // Create a single chunk from content
          chunks = [{
            content: input.content,
            metadata: input.metadata
          }];
        }

        // Add chunks to vector store
        const ids = await vectorStoreService.addChunks(
          organizationId,
          input.documentId || null,
          chunks
        );

        return {
          success: true,
          embeddingIds: ids,
          count: ids.length
        };
      } catch (error) {
        console.error("Error adding embeddings:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add embeddings"
        });
      }
    }),

  // Search embeddings
  search: authenticatedProcedure
    .input(searchInput)
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      
      if (!organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization ID is required"
        });
      }

      try {
        // Initialize vector store if needed
        if (!vectorStoreService.initialized) {
          await vectorStoreService.initialize();
        }

        const results = await vectorStoreService.search(
          organizationId,
          input.query,
          input.limit
        );

        return {
          results,
          count: results.length
        };
      } catch (error) {
        console.error("Error searching embeddings:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search embeddings"
        });
      }
    }),

  // Get statistics
  stats: authenticatedProcedure
    .query(async ({ ctx }) => {
      const organizationId = ctx.organizationId;
      
      if (!organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization ID is required"
        });
      }

      try {
        const stats = await vectorStoreService.getStatistics(organizationId);
        return stats;
      } catch (error) {
        console.error("Error getting embedding stats:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get statistics"
        });
      }
    }),

  // Delete by document
  deleteByDocument: authenticatedProcedure
    .input(z.object({
      documentId: z.string().uuid()
    }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      
      if (!organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization ID is required"
        });
      }

      try {
        const deleted = await vectorStoreService.deleteByDocumentId(
          organizationId,
          input.documentId
        );

        return {
          success: true,
          deleted
        };
      } catch (error) {
        console.error("Error deleting embeddings:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete embeddings"
        });
      }
    })
});