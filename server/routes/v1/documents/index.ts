import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { DocumentProcessorFactory } from "@server/processors";
import { vectorStoreService } from "@server/services/vector-store.service";
import { documentRepository } from "@server/repositories/document.repository";
import { splitTextIntoChunks, createChunkMetadata } from "@server/utils/text-chunking";
import { sanitizeContent } from "@server/utils/sanitize";
import { sanitizeEditorHtml } from "@server/utils/sanitize-html";
import {
  DocumentationType,
  DocumentationStatus,
  DocumentVisibility,
  ImportMethod,
} from "@server/entities/document.entity";
import { documentListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";
import { documentRetryService } from "@server/services/document-retry.service";
import { storageService } from "@server/services/storage.service";
import { AppDataSource } from "@server/database/data-source";
import { createLogger } from "@server/lib/logger";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { documentSourceRepository } from "@server/repositories/document-source.repository";
import type { HayPluginManifest } from "@server/types/plugin.types";

const logger = createLogger("documents");

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
        contentJson: document.contentJson,
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
      const organizationId = ctx.organizationId!;
      const query = input.query.trim();
      const limit = input.limit;

      // Run vector search and keyword search in parallel
      const [vectorResults, keywordResults] = await Promise.all([
        // Vector similarity search (grouped by document)
        (async () => {
          if (!vectorStoreService.initialized) {
            await vectorStoreService.initialize();
          }
          return vectorStoreService.searchDocuments(organizationId, query, limit);
        })(),
        // Keyword search directly on documents table (title + content ILIKE)
        (async () => {
          const keywordQuery = `
            SELECT
              id,
              CASE
                WHEN title ILIKE $2 THEN 0.9
                WHEN title ILIKE $3 THEN 0.7
                WHEN content ILIKE $3 THEN 0.4
                ELSE 0
              END as keyword_score
            FROM documents
            WHERE organization_id = $1
              AND (title ILIKE $3 OR content ILIKE $3)
            ORDER BY
              CASE WHEN title ILIKE $2 THEN 0 ELSE 1 END,
              CASE WHEN title ILIKE $3 THEN 0 ELSE 1 END
            LIMIT $4
          `;
          const escapedQuery = query.replace(/%/g, "\\%").replace(/_/g, "\\_");
          return AppDataSource.query(keywordQuery, [
            organizationId,
            escapedQuery, // exact title match
            `%${escapedQuery}%`, // partial match
            limit,
          ]) as Promise<Array<{ id: string; keyword_score: number }>>;
        })(),
      ]);

      // Merge results: combine scores from both sources
      const scoreMap = new Map<string, { vectorScore: number; keywordScore: number }>();

      for (const vr of vectorResults) {
        scoreMap.set(vr.documentId, {
          vectorScore: vr.similarity,
          keywordScore: 0,
        });
      }

      for (const kr of keywordResults) {
        const existing = scoreMap.get(kr.id);
        if (existing) {
          existing.keywordScore = parseFloat(String(kr.keyword_score));
        } else {
          scoreMap.set(kr.id, {
            vectorScore: 0,
            keywordScore: parseFloat(String(kr.keyword_score)),
          });
        }
      }

      // Compute combined relevance score
      const rankedDocIds = [...scoreMap.entries()]
        .map(([docId, scores]) => {
          // Weight: vector similarity contributes 60%, keyword match 40%
          // Documents matching both get a natural boost
          const combinedScore = scores.vectorScore * 0.6 + scores.keywordScore * 0.4;
          return { docId, score: combinedScore };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (rankedDocIds.length === 0) {
        return [];
      }

      // Fetch full document details for all matched documents
      const documents = (
        await Promise.all(rankedDocIds.map(({ docId }) => documentRepository.findById(docId)))
      ).filter((doc) => doc && doc.organizationId === organizationId);

      // Return documents in ranked order, skipping any not found
      const results = [];
      for (const { docId, score } of rankedDocIds) {
        const doc = documents.find((d) => d?.id === docId);
        if (!doc) continue;
        results.push({
          id: doc.id,
          title: doc.title || "Untitled",
          description: doc.description,
          content: doc.content?.substring(0, 200) || "",
          type: doc.type || DocumentationType.ARTICLE,
          status: doc.status || DocumentationStatus.PUBLISHED,
          visibility: doc.visibility,
          sourceUrl: doc.sourceUrl,
          importMethod: doc.importMethod,
          relevanceScore: score,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          hasAttachment: !!(doc.attachments && doc.attachments.length > 0),
        });
      }
      return results;
    }),
  create: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.CREATE)
    .input(
      z.object({
        title: z.string(),
        content: z.string(),
        contentJson: z.record(z.string(), z.unknown()).optional(),
        contentHtml: z.string().optional(),
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

      const isEditorAuthored = !!input.contentJson;
      if (isEditorAuthored && input.contentHtml) {
        processedContent = sanitizeEditorHtml(input.contentHtml);
      }

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
          logger.error({ err: uploadError }, "Failed to save document file to storage");
          // Continue without attachment - document content will still be processed
        }
      }

      // Sanitize content to remove null bytes before saving
      const sanitizedContent = sanitizeContent(processedContent);

      const importMethod = isEditorAuthored ? ImportMethod.EDITOR : ImportMethod.UPLOAD;

      // Save document to database first
      const document = await documentRepository.create({
        title: sanitizeContent(input.title),
        content: sanitizedContent,
        contentJson: input.contentJson,
        type: input.type || DocumentationType.ARTICLE,
        status: input.status || DocumentationStatus.DRAFT,
        visibility: input.visibility || DocumentVisibility.PRIVATE,
        organizationId: ctx.organizationId,
        importMethod,
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
        contentJson: z.record(z.string(), z.unknown()).optional(),
        contentHtml: z.string().optional(),
        status: z.nativeEnum(DocumentationStatus).optional(),
        regenerateEmbeddings: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find existing document
      const document = await documentRepository.findById(input.id);
      if (!document || document.organizationId !== ctx.organizationId) {
        throw new Error("Document not found");
      }

      const sanitizedHtml = input.contentHtml ? sanitizeEditorHtml(input.contentHtml) : undefined;
      const nextContent = sanitizedHtml ?? input.content;

      // Update document
      const updatedDocument = await documentRepository.update(document.id, ctx.organizationId!, {
        ...(input.title && { title: input.title }),
        ...(nextContent !== undefined && { content: nextContent }),
        ...(input.contentJson && { contentJson: input.contentJson }),
        ...(input.status && { status: input.status }),
      });

      if (!updatedDocument) {
        throw new Error("Failed to update document");
      }

      // Regenerate embeddings if content changed or explicitly requested
      if (
        (nextContent !== undefined && nextContent !== document.content) ||
        input.regenerateEmbeddings
      ) {
        // Ensure vector store is initialized
        if (!vectorStoreService.initialized) {
          await vectorStoreService.initialize();
        }

        // Delete old embeddings
        await vectorStoreService.deleteByDocumentId(ctx.organizationId!, document.id);

        // Split new content into chunks
        const contentToEmbed = nextContent || document.content || "";
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

  uploadImage: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.CREATE)
    .input(
      z.object({
        fileBuffer: z.string(),
        mimeType: z.string(),
        fileName: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new Error("Organization ID is required");
      }
      if (!input.mimeType.startsWith("image/")) {
        throw new Error("Only image uploads are allowed");
      }

      const buffer = Buffer.from(input.fileBuffer, "base64");
      const maxSize = 10 * 1024 * 1024;
      if (buffer.length > maxSize) {
        throw new Error("Image too large (max 10MB)");
      }

      const result = await storageService.upload({
        buffer,
        originalName: input.fileName,
        mimeType: input.mimeType,
        folder: "document-images",
        organizationId: ctx.organizationId,
        uploadedById: ctx.user.id,
        maxSize,
      });

      return { url: result.url };
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

  getImporters: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .output(
      z.object({
        native: z.array(
          z.object({
            id: z.string(),
            kind: z.literal("upload").or(z.literal("web")),
            name: z.string(),
            description: z.string(),
            icon: z.string(),
            connected: z.boolean(),
          }),
        ),
        plugins: z.array(
          z.object({
            id: z.string(),
            kind: z.literal("plugin"),
            pluginId: z.string(),
            name: z.string(),
            description: z.string(),
            icon: z.string(),
            thumbnail: z.string().nullable(),
            connected: z.boolean(),
            sourceIds: z.array(z.string()),
          }),
        ),
      }),
    )
    .query(async ({ ctx }) => {
      const organizationId = ctx.organizationId!;

      const native = [
        {
          id: "upload",
          kind: "upload" as const,
          name: "Upload files",
          description: "Upload PDFs, Word docs, markdown, or text files",
          icon: "upload",
          connected: true,
        },
        {
          id: "web",
          kind: "web" as const,
          name: "Import from website",
          description: "Crawl a website and import discovered pages",
          icon: "globe",
          connected: true,
        },
      ];

      // Discover plugins with document_importer capability
      const allPlugins = pluginManagerService.getAllPlugins();
      const importerPlugins = allPlugins.filter((plugin) => {
        const manifest = plugin.manifest as HayPluginManifest | undefined;
        if (!manifest) return false;
        const typeMatch =
          Array.isArray(manifest.type) && manifest.type.includes("document_importer");
        const capabilityMatch = manifest.capabilities?.document_importer !== undefined;
        return typeMatch || capabilityMatch;
      });

      // Pre-fetch all document sources for this org once to avoid N+1
      const orgSources = await documentSourceRepository.findByOrganization(organizationId);

      const plugins = await Promise.all(
        importerPlugins.map(async (plugin) => {
          const manifest = plugin.manifest as HayPluginManifest;
          const importerMeta = manifest.capabilities?.document_importer;
          const publicId = manifest.id ?? plugin.pluginId;

          const instance = await pluginInstanceRepository.findByOrgAndPlugin(
            organizationId,
            plugin.pluginId,
          );

          const sourceIds = orgSources
            .filter((s) => s.pluginId === plugin.pluginId)
            .map((s) => s.id);

          return {
            id: publicId,
            kind: "plugin" as const,
            pluginId: plugin.pluginId,
            name: importerMeta?.name ?? plugin.name,
            description: importerMeta?.description ?? manifest.description ?? "",
            icon: importerMeta?.icon ?? publicId,
            thumbnail: `/plugins/thumbnails/${encodeURIComponent(plugin.pluginId)}`,
            connected: instance !== null,
            sourceIds,
          };
        }),
      );

      return { native, plugins };
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
