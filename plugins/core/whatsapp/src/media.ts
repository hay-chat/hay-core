import type { ChannelContext } from "./context.js";
import type { WhatsAppConnection } from "./connection.js";

/**
 * Inbound media ingestion (PLAN.md D9).
 *
 * Webhooks only carry a media id. We resolve it to Meta's 5-minute URL,
 * download the bytes with the business token and push them to Hay storage via
 * `media.upload`, so the message's attachment points at Hay rather than at a
 * URL that expires. Voice notes are transcribed in the same call.
 *
 * Best effort: a media failure must never drop the customer's message, so this
 * never throws — the caller falls back to a text placeholder.
 */

export type InboundMediaType = "image" | "video" | "audio" | "document" | "sticker";

export interface InboundMedia {
  id: string;
  mime_type?: string;
  filename?: string;
  caption?: string;
  voice?: boolean;
}

/** The attachment shape `messages.receive` accepts. */
export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface MediaResult {
  attachment?: Attachment;
  transcript?: string;
  failure?: string;
}

const MB = 1024 * 1024;

/**
 * Download cap per type: Meta's own limit (images 5 MB, audio and video
 * 16 MB, stickers 500 KB), and for documents (Meta: 100 MB) Hay's
 * conversation-media cap (CONVERSATION_MEDIA_MAX_SIZE_MB, default 25).
 */
export const MAX_MEDIA_BYTES: Record<InboundMediaType, number> = {
  image: 5 * MB,
  sticker: MB,
  audio: 16 * MB,
  video: 16 * MB,
  document: 25 * MB,
};

/**
 * What the agent sees for media that arrived without a caption, e.g.
 * `[Customer sent a photo]` or `[Customer sent a document: invoice.pdf]`.
 */
export function describeMedia(type: InboundMediaType, media: InboundMedia): string {
  switch (type) {
    case "image":
      return "[Customer sent a photo]";
    case "sticker":
      return "[Customer sent a sticker]";
    case "video":
      return "[Customer sent a video]";
    case "audio":
      return media.voice ? "[Customer sent a voice message]" : "[Customer sent an audio file]";
    case "document": {
      const name = media.filename?.trim();
      return name ? `[Customer sent a document: ${name.slice(0, 120)}]` : "[Customer sent a document]";
    }
  }
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
};

/** `audio/ogg; codecs=opus` → `audio/ogg` (storage and STT match on the bare type). */
export function bareMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/** The document's own filename, else `<type>-<mediaId>.<ext>`. */
export function mediaFilename(
  type: InboundMediaType,
  mediaId: string,
  mimeType: string,
  filename?: string,
): string {
  const own = filename?.trim();
  if (own) {
    return own.slice(0, 255);
  }
  return `${type}-${mediaId}.${EXTENSIONS[mimeType] ?? "bin"}`;
}

interface UploadResult extends Attachment {
  transcript?: string;
}

export async function ingestMedia(input: {
  type: InboundMediaType;
  media: InboundMedia;
  connection: WhatsAppConnection;
  ctx: ChannelContext;
}): Promise<MediaResult> {
  const { type, media, connection, ctx } = input;
  const token = connection.accessToken;

  try {
    const info = await ctx.graph.getMedia(media.id, token);
    const bytes = await ctx.graph.downloadMedia(info.url, token, MAX_MEDIA_BYTES[type]);
    const mimeType = bareMimeType(info.mime_type || media.mime_type || "application/octet-stream");

    const uploaded = await ctx.api.mutation<UploadResult>("media.upload", {
      data: bytes.toString("base64"),
      mimeType,
      filename: mediaFilename(type, media.id, mimeType, media.filename),
      transcribe: type === "audio",
    });

    const { id, name, url, type: attachmentType, size, transcript } = uploaded;
    return {
      attachment: { id, name, url, type: attachmentType, size },
      ...(transcript ? { transcript } : {}),
    };
  } catch (error: unknown) {
    // Never log content or URLs — only enough to diagnose.
    const reason = error instanceof Error ? error.message : "unknown error";
    ctx.logger.warn("WhatsApp inbound media could not be ingested", {
      type,
      mediaId: media.id,
      reason,
    });
    return { failure: reason.slice(0, 200) };
  }
}
