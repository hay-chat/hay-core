import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { vectorStoreService } from "@server/services/vector-store.service";
import { documentRepository } from "@server/repositories/document.repository";
import { createLogger } from "@server/lib/logger";
import { boundedJsonRecord } from "@server/lib/validation/json-record";
import { RESOURCES, ACTIONS } from "@server/types/scopes";

const logger = createLogger("embeddings");

const CHUNK_MAX_LENGTH = 20_000;
const CHUNKS_MAX_COUNT = 100;
const CHUNK_METADATA_MAX_BYTES = 4_096;

const embedInput = z.object({
  documentId: z.string().uuid().nullable().optional(),
  content: z.string().min(1).max(CHUNK_MAX_LENGTH),
  metadata: boundedJsonRecord(CHUNK_METADATA_MAX_BYTES).optional(),
  chunks: z
    .array(
      z.object({
        content: z.string().min(1).max(CHUNK_MAX_LENGTH),
        metadata: boundedJsonRecord(CHUNK_METADATA_MAX_BYTES).optional(),
      }),
    )
    .max(CHUNKS_MAX_COUNT)
    .optional(),
});

const searchInput = z.object({
  query: z.string().min(1).max(2_000),
  limit: z.number().min(1).max(100).default(10),
});

export const embeddingsRouter = t.router({
  // Add document embeddings
  add: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.UPDATE)
    .input(embedInput)
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;

      if (!organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization ID is required",
        });
      }

      if (
        input.documentId &&
        !(await documentRepository.findByIdAndOrganization(input.documentId, organizationId))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      }

      try {
        // Initialize vector store if needed
        if (!vectorStoreService.initialized) {
          await vectorStoreService.initialize();
        }

        let chunks: Array<{ content: string; metadata?: Record<string, unknown> }> = [];

        if (input.chunks && input.chunks.length > 0) {
          // Use provided chunks
          chunks = input.chunks;
        } else {
          // Create a single chunk from content
          chunks = [
            {
              content: input.content,
              metadata: input.metadata,
            },
          ];
        }

        // Add chunks to vector store
        const ids = await vectorStoreService.addChunks(
          organizationId,
          input.documentId || null,
          chunks,
        );

        return {
          success: true,
          embeddingIds: ids,
          count: ids.length,
        };
      } catch (error) {
        logger.error({ err: error }, "Error adding embeddings");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add embeddings",
        });
      }
    }),

  // Search embeddings
  search: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .input(searchInput)
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;

      if (!organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization ID is required",
        });
      }

      try {
        // Initialize vector store if needed
        if (!vectorStoreService.initialized) {
          await vectorStoreService.initialize();
        }

        const results = await vectorStoreService.search(organizationId, input.query, input.limit);

        return {
          results,
          count: results.length,
        };
      } catch (error) {
        logger.error({ err: error }, "Error searching embeddings");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search embeddings",
        });
      }
    }),

  // Get statistics
  stats: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ).query(async ({ ctx }) => {
    const organizationId = ctx.organizationId;

    if (!organizationId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Organization ID is required",
      });
    }

    try {
      const stats = await vectorStoreService.getStatistics(organizationId);
      return stats;
    } catch (error) {
      logger.error({ err: error }, "Error getting embedding stats");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get statistics",
      });
    }
  }),

  // Delete by document
  deleteByDocument: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.DELETE)
    .input(
      z.object({
        documentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;

      if (!organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization ID is required",
        });
      }

      try {
        const deleted = await vectorStoreService.deleteByDocumentId(
          organizationId,
          input.documentId,
        );

        return {
          success: true,
          deleted,
        };
      } catch (error) {
        logger.error({ err: error }, "Error deleting embeddings");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete embeddings",
        });
      }
    }),
});
