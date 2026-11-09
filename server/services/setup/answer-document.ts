import { TRPCError } from "@trpc/server";
import { documentRepository } from "@server/repositories/document.repository";
import {
  DocumentationStatus,
  DocumentationType,
  ImportMethod,
  type Document,
} from "@server/entities/document.entity";
import { vectorStoreService } from "@server/services/vector-store.service";
import { splitTextIntoChunks, createChunkMetadata } from "@server/utils/text-chunking";
import { createLogger } from "@server/lib/logger";
import { answerToHtml, answerToTiptapJson, plainTextOf } from "./answer-text";

const logger = createLogger("setup-answer-document");

/**
 * Embeds `title\n\ntext` for a document, replacing any chunks it had. If embedding fails the
 * document is marked as errored and the failure is raised: a saved answer that cannot be found
 * must not look like success.
 */
// TODO: `documents.create` repeats this chunk-and-embed sequence inline; move both onto one service.
async function embedAnswer(
  organizationId: string,
  documentId: string,
  title: string,
  text: string,
): Promise<void> {
  try {
    if (!vectorStoreService.initialized) await vectorStoreService.initialize();
    await vectorStoreService.deleteByDocumentId(organizationId, documentId);
    const chunks = splitTextIntoChunks(`${title}\n\n${text}`, {
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    await vectorStoreService.addChunks(
      organizationId,
      documentId,
      chunks.map((content, index) => ({
        content,
        metadata: createChunkMetadata(index, chunks.length, {
          documentId,
          documentTitle: title,
          documentType: DocumentationType.FAQ,
        }),
      })),
    );
  } catch (err) {
    logger.error({ err, organizationId, documentId }, "Embedding the answer failed");
    await documentRepository.update(documentId, organizationId, {
      status: DocumentationStatus.ERROR,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not save the answer. Try again.",
    });
  }
}

/**
 * Saves a customer-written answer as a published FAQ editor document, so Knowledge can open and
 * edit it, and embeds it: it is searchable as soon as this resolves. One document per question:
 * pass the question's current one as `existing` to update it in place.
 */
export async function saveAnswerDocument(
  organizationId: string,
  input: { existing?: Document | null; title: string; text: string },
): Promise<Document> {
  const fields = {
    title: input.title,
    content: answerToHtml(input.text),
    contentJson: answerToTiptapJson(input.text),
    importMethod: ImportMethod.EDITOR,
    type: DocumentationType.FAQ,
    status: DocumentationStatus.PROCESSING,
  };
  const document = input.existing
    ? await documentRepository.update(input.existing.id, organizationId, fields)
    : await documentRepository.create({ ...fields, organizationId });
  if (!document) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Answer document not found" });
  }

  await embedAnswer(organizationId, document.id, input.title, plainTextOf(fields.content));

  return (
    (await documentRepository.update(document.id, organizationId, {
      status: DocumentationStatus.PUBLISHED,
    })) ?? document
  );
}
