import FileType from "file-type";
import sharp from "sharp";

/**
 * Sanitising for conversation media (files sent by shoppers through channels).
 *
 * - Only a narrow allow-list: raster images, PDF, plain text, voice/audio and
 *   video. No SVG (script), archives or Office files (macros, hidden content).
 * - The type is taken from the file's magic bytes, never from the sender's
 *   declared type or extension.
 * - Images are re-encoded, which drops EXIF/GPS and any trailing payload
 *   (polyglot files).
 *
 * HEIC/HEIF is refused: the prebuilt sharp/libvips ships without an HEVC
 * decoder, so those images can't be converted or stripped here.
 */

/** Allowed conversation media types and the extension each is stored with. */
export const CONVERSATION_MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/aac": ".aac",
  "audio/amr": ".amr",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "video/quicktime": ".mov",
};

/** Text has no magic bytes; accepted only when nothing binary is detected. */
const TEXT_TYPES = new Set(["text/plain", "text/csv"]);

/** file-type names that we store under a canonical allow-list name. */
const DETECTED_ALIASES: Record<string, string> = {
  "audio/opus": "audio/ogg", // WhatsApp voice notes: Opus in an Ogg container
  "audio/x-m4a": "audio/mp4",
  "video/x-m4v": "video/mp4",
};

/**
 * ISO-BMFF containers: the brand decides what file-type reports, so an M4A
 * voice note may be detected as video/mp4. Within one family the sender's
 * declared type is kept, as it says whether to play it as audio or video.
 */
const MP4_FAMILY = new Set(["audio/mp4", "video/mp4", "video/3gpp", "video/quicktime"]);

const REENCODED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export class MediaRejectedError extends Error {}

export interface SanitizedMedia {
  buffer: Buffer;
  mimeType: string;
}

function bareMime(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/** Real type of the file from its content, checked against the allow-list. */
async function detectType(buffer: Buffer, declaredMime: string): Promise<string> {
  const detected = await FileType.fromBuffer(buffer);

  if (!detected) {
    if (TEXT_TYPES.has(declaredMime)) return declaredMime;
    throw new MediaRejectedError(
      `File content is not a supported type (declared ${declaredMime || "unknown"})`,
    );
  }

  if (detected.mime === "image/heic" || detected.mime === "image/heif") {
    throw new MediaRejectedError("HEIC/HEIF images are not supported");
  }

  const mimeType = DETECTED_ALIASES[detected.mime] ?? detected.mime;
  if (!CONVERSATION_MEDIA_TYPES[mimeType]) {
    throw new MediaRejectedError(`File type not allowed: ${detected.mime}`);
  }

  if (MP4_FAMILY.has(mimeType) && MP4_FAMILY.has(declaredMime)) return declaredMime;
  return mimeType;
}

/**
 * Decoded-size caps. A few KB of GIF or WebP can describe thousands of large
 * frames that decode to gigabytes, so the decoded pixel count is capped across
 * all frames (sharp counts the whole frame stack when `animated` is set), and
 * so is the frame count. 50 MP still admits a 48 MP phone photo.
 */
export const MAX_IMAGE_INPUT_PIXELS = 50_000_000;
export const MAX_ANIMATION_FRAMES = 300;

/** Decode and re-encode in the same format, applying EXIF orientation first. */
async function reencodeImage(buffer: Buffer, mimeType: string): Promise<Buffer> {
  const animated = mimeType === "image/gif" || mimeType === "image/webp";

  // Header-only read: refuse with a clear reason before any frame is decoded.
  // The decode below still enforces limitInputPixels on its own.
  const {
    width = 0,
    height = 0,
    pages = 1,
  } = await sharp(buffer, {
    animated,
    limitInputPixels: false,
  }).metadata();
  if (pages > MAX_ANIMATION_FRAMES) {
    throw new MediaRejectedError(`Image has too many frames (${pages})`);
  }
  if (width * height > MAX_IMAGE_INPUT_PIXELS) {
    throw new MediaRejectedError(`Image is too large to process (${width}x${height})`);
  }

  const image = sharp(buffer, { animated, limitInputPixels: MAX_IMAGE_INPUT_PIXELS }).autoOrient();

  switch (mimeType) {
    case "image/jpeg":
      return image.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    case "image/png":
      return image.png().toBuffer();
    case "image/webp":
      return image.webp({ quality: 85 }).toBuffer();
    default:
      return image.gif().toBuffer();
  }
}

async function reencodeOrReject(buffer: Buffer, mimeType: string): Promise<SanitizedMedia> {
  try {
    return { buffer: await reencodeImage(buffer, mimeType), mimeType };
  } catch (error) {
    if (error instanceof MediaRejectedError) throw error;
    throw new MediaRejectedError(`Image could not be processed (${mimeType})`);
  }
}

export async function sanitizeConversationMedia(
  buffer: Buffer,
  declaredMimeType: string,
): Promise<SanitizedMedia> {
  const mimeType = await detectType(buffer, bareMime(declaredMimeType));

  if (!REENCODED_IMAGE_TYPES.has(mimeType)) {
    return { buffer, mimeType };
  }

  return reencodeOrReject(buffer, mimeType);
}

/**
 * Images for public folders (logos, avatars, document images): raster only,
 * detected from content and re-encoded. SVG and anything else is refused, as
 * these files are served from a public URL under our origin.
 */
export async function sanitizePublicImage(buffer: Buffer): Promise<SanitizedMedia> {
  const detected = await FileType.fromBuffer(buffer);
  if (!detected || !REENCODED_IMAGE_TYPES.has(detected.mime)) {
    throw new MediaRejectedError("Only JPEG, PNG, GIF or WebP images are allowed");
  }
  return reencodeOrReject(buffer, detected.mime);
}
