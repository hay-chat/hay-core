import mime from "mime-types";
import { StorageService, type UploadResult } from "../services/storage.service";

export interface ParsedUpload {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

/**
 * Parse base64 data URI: "data:image/png;base64,iVBORw0KG..."
 */
export function parseBase64Upload(dataUri: string): ParsedUpload {
  const matches = dataUri.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid data URI format. Expected: data:<mime-type>;base64,<data>");
  }

  const mimeType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, "base64");

  // Extract extension from MIME type
  const ext = mime.extension(mimeType) || "bin";
  const originalName = `upload.${ext}`;

  return {
    buffer,
    originalName,
    mimeType,
    size: buffer.length,
  };
}

/**
 * Main helper to use in tRPC procedures
 * Handles base64 upload and stores it using StorageService
 */
export async function handleUpload(
  dataUri: string,
  folder: string,
  organizationId: string,
  uploadedById?: string,
  options?: { maxSize?: number }
): Promise<UploadResult> {
  const parsed = parseBase64Upload(dataUri);
  const storageService = new StorageService();

  return storageService.upload({
    buffer: parsed.buffer,
    originalName: parsed.originalName,
    mimeType: parsed.mimeType,
    folder,
    organizationId,
    uploadedById,
    maxSize: options?.maxSize,
  });
}
