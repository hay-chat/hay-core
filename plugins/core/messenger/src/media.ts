import type { HayLogger } from "@hay/plugin-sdk/types";

/**
 * Inbound Messenger attachments.
 *
 * Messenger delivers attachments as CDN URLs that expire, so images, videos,
 * voice notes and files are downloaded at once and pushed to Hay.chat storage
 * via `media.upload` (voice notes are transcribed in the same call). Stickers,
 * locations and shared links become a text line only.
 *
 * Best effort: a failed attachment becomes a placeholder line, never a
 * dropped message. Never logs URLs or content.
 */

/** Messenger's own cap for attachments; core enforces its own limit too. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Attachment types whose bytes we store. */
const STORED_TYPES = new Set(["image", "video", "audio", "file"]);

export interface MessengerAttachment {
  type?: string;
  payload?: { url?: string; title?: string; sticker_id?: number | string } | null;
}

/** The attachment shape `messages.receive` accepts. */
export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

interface UploadResult extends Attachment {
  transcript?: string;
}

export interface MediaApi {
  mutation<T>(procedure: string, input: Record<string, unknown>): Promise<T>;
}

export interface IngestedMessage {
  /** Text the agent sees: the shopper's text, plus a line per attachment it can't see. */
  content: string;
  attachments: Attachment[];
  /** True when `content` is only the "[Customer sent …]" line for stored media, which the Inbox and widget show instead of the text. */
  mediaPlaceholder: boolean;
  voiceNote: boolean;
  /** Attachments that could not be stored (type + reason), for diagnosis in metadata. */
  failures: Array<{ type: string; reason: string }>;
}

const NOUNS: Record<string, [string, string]> = {
  image: ["a photo", "photos"],
  video: ["a video", "videos"],
  audio: ["a voice message", "voice messages"],
  file: ["a file", "files"],
};

/** Line for stored attachments without text, e.g. `[Customer sent 2 photos]`. */
export function describeStored(types: string[]): string {
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  const parts = [...counts].map(([type, count]) => {
    const [one, many] = NOUNS[type] ?? ["an attachment", "attachments"];
    return count === 1 ? one : `${count} ${many}`;
  });
  return `[Customer sent ${parts.join(" and ")}]`;
}

/** Line for an attachment that is never stored, or `null` when the type is stored. */
export function placeholderFor(attachment: MessengerAttachment): string | null {
  const type = attachment.type ?? "";
  const title = attachment.payload?.title?.trim();
  // A sticker (including the thumbs-up) arrives as an image with a sticker id.
  if (attachment.payload?.sticker_id !== undefined) return "[Customer sent a sticker]";
  switch (type) {
    case "location":
      return title ? `[Customer shared a location: ${title}]` : "[Customer shared a location]";
    case "fallback":
    case "template":
    case "share":
      return title ? `[Customer shared a link: ${title}]` : "[Customer shared a link]";
    default:
      return STORED_TYPES.has(type)
        ? null
        : "[Customer sent a Messenger attachment Hay.chat can't show]";
  }
}

function unloaded(type: string): string {
  const noun = (NOUNS[type]?.[0] ?? "an attachment").replace(/^(a|an) /, "");
  const article = /^[aeiou]/.test(noun) ? "an" : "a";
  return `[Customer sent ${article} ${noun} that could not be loaded]`;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
};

async function download(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`download failed with status ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES) {
    throw new Error(`too large: ${declared} bytes`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`too large: ${bytes.length} bytes`);
  }
  const mimeType = (response.headers.get("content-type") ?? "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return { bytes, mimeType };
}

/**
 * Turn an inbound Messenger message (text + attachments) into what
 * `messages.receive` takes. Always returns non-empty `content` when the
 * message has any attachment, so the shopper is never met with silence.
 */
export async function ingestMessage(input: {
  text: string;
  attachments: MessengerAttachment[];
  mid?: string;
  api: MediaApi;
  logger: HayLogger;
  fetchImpl?: typeof fetch;
}): Promise<IngestedMessage> {
  const { text, attachments, mid, api, logger } = input;
  const fetchImpl = input.fetchImpl ?? fetch;

  const stored: Attachment[] = [];
  const storedTypes: string[] = [];
  const lines: string[] = [];
  const failures: IngestedMessage["failures"] = [];
  const transcripts: string[] = [];

  for (const [index, attachment] of attachments.slice(0, 10).entries()) {
    const placeholder = placeholderFor(attachment);
    if (placeholder) {
      lines.push(placeholder);
      continue;
    }

    const type = attachment.type ?? "file";
    const url = attachment.payload?.url;
    try {
      if (!url) throw new Error("attachment has no url");
      const { bytes, mimeType } = await download(url, fetchImpl);
      const suffix = (mid ?? "message").slice(-12).replace(/[^A-Za-z0-9_-]/g, "");
      const uploaded = await api.mutation<UploadResult>("media.upload", {
        data: bytes.toString("base64"),
        mimeType,
        filename: `${type}-${suffix}-${index + 1}.${EXTENSIONS[mimeType] ?? "bin"}`,
        transcribe: type === "audio",
      });
      const { id, name, url: storedUrl, type: storedType, size, transcript } = uploaded;
      stored.push({ id, name, url: storedUrl, type: storedType, size });
      storedTypes.push(type);
      if (transcript) transcripts.push(transcript);
    } catch (error: unknown) {
      const reason = (error instanceof Error ? error.message : "unknown error").slice(0, 200);
      logger.warn("Messenger attachment could not be ingested", { type, mid, reason });
      failures.push({ type, reason });
      lines.push(unloaded(type));
    }
  }

  const trimmed = text.trim();
  const voiceNote = transcripts.length > 0;
  // A voice note's words are what the shopper said: they become the message text.
  const spoken = transcripts.join("\n");
  const shopperText = [trimmed, spoken].filter(Boolean).join("\n");
  const needsStoredLine = !shopperText && storedTypes.length > 0;
  const generated = [...(needsStoredLine ? [describeStored(storedTypes)] : []), ...lines];
  const content = [shopperText, ...generated].filter(Boolean).join("\n");

  return {
    content,
    attachments: stored,
    mediaPlaceholder: needsStoredLine && lines.length === 0,
    voiceNote,
    failures,
  };
}
