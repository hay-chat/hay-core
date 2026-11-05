import { TRPCError } from "@trpc/server";
import { documentRepository } from "@server/repositories/document.repository";
import {
  DocumentationStatus,
  DocumentationType,
  type Document,
} from "@server/entities/document.entity";
import { vectorStoreService } from "@server/services/vector-store.service";
import { splitTextIntoChunks, createChunkMetadata } from "@server/utils/text-chunking";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("setup-answer-document");

// TODO: `documents.create` repeats this chunk-and-embed sequence inline; move both onto one service.
/**
 * Saves a customer-written answer as a published FAQ document and embeds it, so it is
 * searchable as soon as this resolves (embedding is awaited, not queued). If embedding fails the
 * document is marked as errored and the failure is raised: a saved answer that cannot be found
 * must not look like success.
 */
export async function saveAnswerDocument(
  organizationId: string,
  title: string,
  content: string,
): Promise<Document> {
  const document = await documentRepository.create({
    title,
    content,
    type: DocumentationType.FAQ,
    status: DocumentationStatus.PROCESSING,
    organizationId,
  });

  try {
    if (!vectorStoreService.initialized) await vectorStoreService.initialize();
    const chunks = splitTextIntoChunks(`${title}\n\n${content}`, {
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    await vectorStoreService.addChunks(
      organizationId,
      document.id,
      chunks.map((text, index) => ({
        content: text,
        metadata: createChunkMetadata(index, chunks.length, {
          documentId: document.id,
          documentTitle: title,
          documentType: DocumentationType.FAQ,
        }),
      })),
    );
  } catch (err) {
    logger.error({ err, organizationId, documentId: document.id }, "Embedding the answer failed");
    await documentRepository.update(document.id, organizationId, {
      status: DocumentationStatus.ERROR,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not save the answer. Try again.",
    });
  }

  return (
    (await documentRepository.update(document.id, organizationId, {
      status: DocumentationStatus.PUBLISHED,
    })) ?? document
  );
}
