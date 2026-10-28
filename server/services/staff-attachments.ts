import { In, IsNull } from "typeorm";
import type { MessageAttachment } from "@server/database/entities/message.entity";
import { Upload } from "@server/entities/upload.entity";
import { CONVERSATION_MEDIA_FOLDER, storageService } from "./storage.service";
import { cleanFilename } from "./webchat/widget-attachments";

/**
 * Files a person sends from the Inbox composer (D8-16).
 *
 * The composer uploads each file first (`conversations.uploadAttachment`),
 * then sends the message with the upload ids (`conversations.sendMessage`).
 * The message only takes uploads the same person stored in the same
 * organization and that no message uses yet; uploads never sent are swept as
 * orphans after a day (conversation-media.service).
 */

/** Most files on one message from the composer. */
export const STAFF_ATTACHMENT_MAX_COUNT = 10;

export class StaffAttachmentRejectedError extends Error {}

/** Store a file a person picked in the composer. Storage checks type (magic bytes) and size. */
export async function storeStaffAttachment(params: {
  organizationId: string;
  userId: string;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<MessageAttachment> {
  const name = cleanFilename(params.filename, params.mimeType);
  try {
    const stored = await storageService.upload({
      buffer: params.buffer,
      originalName: name,
      mimeType: params.mimeType,
      folder: CONVERSATION_MEDIA_FOLDER,
      organizationId: params.organizationId,
      uploadedById: params.userId,
    });
    return {
      id: stored.upload.id,
      name,
      url: stored.url,
      type: stored.upload.mimeType,
      size: stored.upload.size,
    };
  } catch (error) {
    throw new StaffAttachmentRejectedError(
      error instanceof Error ? error.message : "Upload failed",
    );
  }
}

/**
 * The attachments for a composer message, in the order given. Throws when an
 * id is not an unsent upload of this person in this organization.
 */
export async function staffAttachmentsFromUploads(params: {
  organizationId: string;
  userId: string;
  uploadIds: string[];
}): Promise<MessageAttachment[]> {
  const ids = [...new Set(params.uploadIds)];
  if (!ids.length) return [];
  if (ids.length > STAFF_ATTACHMENT_MAX_COUNT) {
    throw new StaffAttachmentRejectedError("Too many files");
  }

  const uploads = await Upload.find({
    where: {
      id: In(ids),
      organizationId: params.organizationId,
      uploadedById: params.userId,
      folder: CONVERSATION_MEDIA_FOLDER,
      messageId: IsNull(),
    },
  });
  const byId = new Map(uploads.map((upload) => [upload.id, upload]));
  return ids.map((id) => {
    const upload = byId.get(id);
    if (!upload) throw new StaffAttachmentRejectedError("File not found");
    return {
      id: upload.id,
      name: upload.originalName,
      url: storageService.getUrl(upload),
      type: upload.mimeType,
      size: upload.size,
    };
  });
}
