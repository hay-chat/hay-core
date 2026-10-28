import type { MessageAttachment } from "@server/database/entities/message.entity";
import { CONVERSATION_MEDIA_FOLDER, storageService } from "../storage.service";

/**
 * Files a shopper sends from the webchat widget (D8-9): photos and PDFs.
 *
 * The widget sends the file and its optional caption in one call
 * (`publicConversations.sendAttachment`), so an upload never exists without
 * its message.
 */

/** Largest file the widget accepts (the paperclip refuses bigger ones first). */
export const WIDGET_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Types the widget may send. Storage re-checks the content (magic bytes). */
export const WIDGET_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;

/** Base64 length of the largest accepted file, so zod refuses bigger bodies before decoding. */
export const WIDGET_ATTACHMENT_MAX_BASE64_LENGTH = Math.ceil(WIDGET_ATTACHMENT_MAX_BYTES / 3) * 4;

export class WidgetAttachmentRejectedError extends Error {}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** Strict base64 decode: `Buffer.from` silently drops invalid characters. */
export function decodeBase64(data: string): Buffer | null {
  const normalized = data.replace(/\s+/g, "");
  if (normalized.length === 0 || normalized.length % 4 !== 0) return null;
  if (!BASE64_PATTERN.test(normalized)) return null;
  const buffer = Buffer.from(normalized, "base64");
  return buffer.length > 0 ? buffer : null;
}

/**
 * The line the agent reads when the shopper sent files without text, e.g.
 * `[Customer sent a photo]` or `[Customer sent a PDF: invoice.pdf]`. The
 * Inbox and the widget show the files instead of this line.
 */
export function describeCustomerAttachments(attachments: Array<{ name: string; type: string }>) {
  const photos = attachments.filter((attachment) => attachment.type.startsWith("image/"));
  const pdfs = attachments.filter((attachment) => attachment.type === "application/pdf");
  const others = attachments.length - photos.length - pdfs.length;

  const parts: string[] = [];
  if (photos.length) parts.push(photos.length === 1 ? "a photo" : `${photos.length} photos`);
  if (pdfs.length === 1) parts.push(`a PDF: ${pdfs[0].name}`);
  else if (pdfs.length > 1) parts.push(`${pdfs.length} PDFs`);
  if (others > 0) parts.push(others === 1 ? "a file" : `${others} files`);
  return `[Customer sent ${parts.join(" and ") || "a file"}]`;
}

/** File name safe to store and show: no path, no control characters, bounded length. */
export function cleanFilename(filename: string, mimeType: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((char) => char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f)
    .join("")
    .trim()
    .slice(0, 200);
  if (cleaned) return cleaned;
  return mimeType === "application/pdf" ? "document.pdf" : "photo";
}

/**
 * Store a shopper's file in the conversation's organization. Throws
 * WidgetAttachmentRejectedError for anything the shopper should fix
 * (type, size, unreadable content).
 */
export async function storeWidgetAttachment(params: {
  organizationId: string;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<MessageAttachment> {
  const { organizationId, buffer, mimeType } = params;
  if (!(WIDGET_ATTACHMENT_TYPES as readonly string[]).includes(mimeType)) {
    throw new WidgetAttachmentRejectedError("File type not accepted");
  }
  if (buffer.length > WIDGET_ATTACHMENT_MAX_BYTES) {
    throw new WidgetAttachmentRejectedError("File too large");
  }

  const name = cleanFilename(params.filename, mimeType);
  let stored: Awaited<ReturnType<typeof storageService.upload>>;
  try {
    stored = await storageService.upload({
      buffer,
      originalName: name,
      mimeType,
      folder: CONVERSATION_MEDIA_FOLDER,
      organizationId,
      maxSize: WIDGET_ATTACHMENT_MAX_BYTES,
    });
  } catch (error) {
    throw new WidgetAttachmentRejectedError(
      error instanceof Error ? error.message : "Upload failed",
    );
  }

  // The stored type comes from the content. A file that turned out to be
  // something the widget may not send (e.g. a video named .jpg) is removed.
  const type = stored.upload.mimeType;
  if (!(WIDGET_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    await storageService.delete(stored.upload.id).catch(() => undefined);
    throw new WidgetAttachmentRejectedError("File type not accepted");
  }

  return { id: stored.upload.id, name, url: stored.url, type, size: Number(stored.upload.size) };
}
