import { createHmac, timingSafeEqual } from "crypto";
import path from "path";
import { In } from "typeorm";
import { config, getApiUrl } from "../config/env";
import { Upload } from "../entities/upload.entity";

/**
 * Media URLs for private uploads.
 *
 * Uploads are private unless their folder is listed in PUBLIC_UPLOAD_FOLDERS.
 * A private upload is only reachable through `GET /v1/media/:id`, which
 * accepts either a staff session (Bearer + x-organization-id) or a
 * short-lived signature (`?expires=&sig=`) minted by core for a reader that
 * cannot send headers: channel workers fetching outbound attachments today,
 * the webchat widget later.
 *
 * The URL stored on a message (`/v1/media/:id`, no signature) never grants
 * access by itself.
 */

/**
 * Folders whose files stay publicly readable: merchant branding shown to
 * anonymous shoppers (organization logos, agent avatars in the widget and in
 * emails). Nothing a shopper sends ever lands here.
 */
const PUBLIC_UPLOAD_FOLDERS = new Set(["organizations", "avatars"]);

/**
 * Images embedded in knowledge-base documents. Private: the document HTML
 * stores the stable `/v1/media/:id` URL and readers get it signed
 * (signDocumentImageUrls).
 */
export const DOCUMENT_IMAGES_FOLDER = "document-images";

/**
 * Lifetime of signed document-image URLs. Covers a dashboard session and the
 * conversation the AI copies the document into (its reply may embed them).
 */
export const DOCUMENT_IMAGE_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Lifetime of a signed URL handed to a channel worker for one delivery. */
export const DELIVERY_SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Lifetime of the signed links in a handoff (D8-10): the human agent may open
 * the escalated conversation days later in another tool (e.g. Chatwoot).
 */
export const HANDOFF_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isPublicFolder(folder: string): boolean {
  return PUBLIC_UPLOAD_FOLDERS.has(folder);
}

/**
 * Local-disk storage serves `/uploads/{organizationId}/{folder}/...`.
 * Only public folders may be served there; private files go through /v1/media.
 *
 * The static file server decodes and normalises the path after this gate, so
 * the gate decodes it the same way and refuses anything that could step out
 * of the folder it names (`..` segments, encoded or not, backslashes, NUL).
 */
export function isPublicUploadPath(requestPath: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return false;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return false;
  if (decoded.split("/").includes("..")) return false;

  const segments = path.posix.normalize(decoded).split("/").filter(Boolean);
  return segments.length >= 3 && isPublicFolder(segments[1]);
}

const RASTER_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

/**
 * Headers for files served from `/uploads`. Public folders only take raster
 * images; any other file (stored before that rule) is downloaded, never
 * rendered under our origin.
 */
export function setPublicUploadHeaders(
  res: { setHeader(name: string, value: string): unknown },
  filePath: string,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  if (!RASTER_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    res.setHeader("Content-Disposition", "attachment");
  }
}

/** Stable, unsigned URL of a private upload. Requires a staff session to open. */
export function mediaUrl(uploadId: string): string {
  return `${getApiUrl()}/v1/media/${uploadId}`;
}

/**
 * Dedicated key for media signatures, derived from JWT_SECRET so that a media
 * signature can never be replayed as (or forged from) a session token.
 */
function signingKey(): Buffer {
  if (!config.jwt.secret) {
    throw new Error("JWT_SECRET is required to sign media URLs");
  }
  return createHmac("sha256", config.jwt.secret).update("hay:media-url:v1").digest();
}

function signature(uploadId: string, expires: number): string {
  return createHmac("sha256", signingKey()).update(`${uploadId}.${expires}`).digest("base64url");
}

/** URL that opens a private upload without a session until it expires. */
export function signMediaUrl(uploadId: string, ttlSeconds: number, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + ttlSeconds;
  return `${mediaUrl(uploadId)}?expires=${expires}&sig=${signature(uploadId, expires)}`;
}

export function verifyMediaSignature(
  uploadId: string,
  expires: unknown,
  sig: unknown,
  now = Date.now(),
): boolean {
  if (typeof expires !== "string" || typeof sig !== "string" || !/^\d{1,12}$/.test(expires)) {
    return false;
  }
  const expiresAt = Number(expires);
  if (expiresAt * 1000 < now) return false;

  const expected = Buffer.from(signature(uploadId, expiresAt));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Replace each attachment's URL with a signed one when the attachment is a
 * private upload of this organization. Attachments that are not Hay uploads
 * (external URLs) or that live in public folders are returned unchanged.
 *
 * Keyed on `attachment.id` (the upload id), so it also covers messages stored
 * before uploads went private, whose `url` is a former public storage URL.
 */
export async function signAttachmentUrls<T extends { id?: string; url: string }>(
  attachments: T[],
  organizationId: string,
  ttlSeconds: number,
): Promise<T[]> {
  const ids = attachments.map((attachment) => attachment.id).filter(isUuid);
  if (!ids.length) return attachments;

  const uploads = await Upload.find({
    select: { id: true, folder: true },
    where: { id: In(ids), organizationId },
  });
  const privateIds = new Set(
    uploads.filter((upload) => !isPublicFolder(upload.folder)).map((upload) => upload.id),
  );

  return attachments.map((attachment) =>
    attachment.id && privateIds.has(attachment.id)
      ? { ...attachment, url: signMediaUrl(attachment.id, ttlSeconds) }
      : attachment,
  );
}

/**
 * `{api}/v1/media/{id}`, optionally followed by a signature (`&` may be
 * HTML-escaped). Group 1 is the upload id.
 */
/** The upload id of a /v1/media/:id URL, signed or not; null for any other URL. */
export function parseMediaUploadId(url: string): string | null {
  return mediaUrlPattern().exec(url)?.[1] ?? null;
}

function mediaUrlPattern(): RegExp {
  const base = mediaUrl("").replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(
    `${base}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})` +
      `(?:\\?expires=\\d+&(?:amp;)?sig=[A-Za-z0-9_-]+)?`,
    "gi",
  );
}

/** Replace signed media URLs with their stable form, so signatures are never stored. */
export function stripMediaSignatures(text: string): string {
  return text.replace(mediaUrlPattern(), (_match, id: string) => mediaUrl(id));
}

/**
 * Sign every media URL in `text` that points at a document image of this
 * organization; existing signatures are replaced with fresh ones. Other media
 * URLs (other folders, other organizations) are left as they are.
 */
export async function signDocumentImageUrls(
  text: string,
  organizationId: string,
  ttlSeconds = DOCUMENT_IMAGE_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const ids = [...new Set([...text.matchAll(mediaUrlPattern())].map((match) => match[1]))];
  if (!ids.length) return text;

  const uploads = await Upload.find({
    select: { id: true },
    where: { id: In(ids), organizationId, folder: DOCUMENT_IMAGES_FOLDER },
  });
  const imageIds = new Set(uploads.map((upload) => upload.id));
  return text.replace(mediaUrlPattern(), (match, id: string) =>
    imageIds.has(id) ? signMediaUrl(id, ttlSeconds) : match,
  );
}

/** signDocumentImageUrls for editor JSON (image nodes keep the URL in `attrs.src`). */
export async function signDocumentImageUrlsInJson<T>(
  json: T,
  organizationId: string,
  ttlSeconds = DOCUMENT_IMAGE_SIGNED_URL_TTL_SECONDS,
): Promise<T> {
  if (json === null || json === undefined) return json;
  return JSON.parse(await signDocumentImageUrls(JSON.stringify(json), organizationId, ttlSeconds));
}

/** stripMediaSignatures for editor JSON. */
export function stripMediaSignaturesInJson<T>(json: T): T {
  if (json === null || json === undefined) return json;
  return JSON.parse(stripMediaSignatures(JSON.stringify(json)));
}
