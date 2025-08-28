import { t } from "@server/trpc";
import { z } from "zod";
import { DocumentProcessorFactory } from "@server/processors";
import { embeddingService } from "@server/services/embedding.service";
import { documentRepository } from "@server/repositories/document.repository";
import {
  DocumentationType,
  DocumentationStatus,
  DocumentVisibility,
} from "@server/entities/document.entity";

export const documentsRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    return await documentRepository.findByOrganization(ctx.organizationId!);
  }),
  search: t.procedure
    .input(
      z.object({
        query: z.string(),
        limit: z.number().min(1).max(50).optional().default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      // Generate embedding for the search query
      const queryEmbedding = await embeddingService.createEmbedding(
        input.query
      );

      // Find similar documents using vector similarity
      const similarDocuments = await documentRepository.findSimilar(
        queryEmbedding,
        ctx.organizationId!,
        input.limit
      );

      return similarDocuments.map((doc: any) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content?.substring(0, 200) + "...",
        similarity: doc.similarity,
        type: doc.type,
        status: doc.status,
      }));
    }),
  create: t.procedure
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

      // Create embedding from the document content
      const embeddingResult = await embeddingService.createDocumentEmbedding(
        processedContent,
        metadata
      );

      // Save document with embedding to database
      const document = await documentRepository.saveWithEmbedding(
        {
          title: input.title,
          content: processedContent,
          type: input.type || DocumentationType.ARTICLE,
          status: input.status || DocumentationStatus.DRAFT,
          visibility: input.visibility || DocumentVisibility.PRIVATE,
          organizationId: ctx.organizationId,
        },
        embeddingResult.embedding,
        embeddingResult.metadata
      );

      return {
        id: document.id,
        title: document.title,
        embeddingCreated: true,
        metadata: embeddingResult.metadata,
      };
    }),
  update: t.procedure
    .input(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return [];
    }),
  delete: t.procedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return [];
    }),
});
