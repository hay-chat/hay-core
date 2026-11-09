import { fileTypeFromBuffer } from "file-type";
import JSZip from "jszip";
import path from "path";
import { DocumentRejectedError, type ProcessedDocument } from "./base.processor";
import { runWorker } from "./run-worker";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const OOXML_TYPES = new Set([DOCX, PPTX]);
/** Legacy Office files are OLE/CFB containers; the declared type says which one. */
const CFB_TYPES = new Set(["application/msword", "application/vnd.ms-powerpoint"]);
/** Text formats have no magic bytes; picked by the declared type when nothing binary is found. */
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/html", "application/xhtml+xml"]);

/** Total inflated size of an OOXML package, checked before any part is decompressed. */
export const MAX_OOXML_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
/** Parsing runs in a worker thread that is terminated after this long. */
export const DOCUMENT_PROCESSING_TIMEOUT_MS = 60_000;
/** Heap cap of the parse worker thread. */
export const DOCUMENT_PROCESSING_MAX_HEAP_MB = 512;

/** Same extension as this module: .ts under tsx/ts-jest, .js in the build. */
const PARSE_WORKER = path.join(__dirname, `parse.worker${path.extname(__filename)}`);

/** Document type from the file's content; the declared type only breaks ties. */
export async function detectDocumentType(
  buffer: Buffer,
  declaredMimeType: string,
): Promise<string> {
  const declared = declaredMimeType.split(";")[0].trim().toLowerCase();
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) return TEXT_TYPES.has(declared) ? declared : "text/plain";
  if (detected.mime === "application/pdf" || OOXML_TYPES.has(detected.mime)) return detected.mime;
  if (detected.mime === "application/x-cfb" && CFB_TYPES.has(declared)) return declared;
  // file-type may report a valid OOXML package as a plain ZIP, depending on part order.
  if (detected.mime === "application/zip" && OOXML_TYPES.has(declared)) return declared;
  throw new DocumentRejectedError(`Unsupported document type: ${detected.mime}`);
}

/**
 * Refuse macro-enabled packages and packages that inflate past the cap. Reads
 * the ZIP central directory only; nothing is decompressed here.
 */
async function assertSafeOoxml(buffer: Buffer): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (/(^|\/)vbaProject\.bin$/i.test(entry.name)) {
      throw new DocumentRejectedError("Macro-enabled documents are not supported");
    }
    // JSZip keeps the central-directory size here and verifies it on inflate.
    total +=
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  }
  if (total > MAX_OOXML_UNCOMPRESSED_BYTES) {
    throw new DocumentRejectedError("Document is too large once uncompressed");
  }
}

export class DocumentProcessorFactory {
  /**
   * Process an uploaded document. The caller checks the size first; the type
   * is detected from the content, never taken from the client.
   */
  async processDocument(buffer: Buffer, declaredMimeType: string, fileName?: string) {
    const mimeType = await detectDocumentType(buffer, declaredMimeType);
    if (OOXML_TYPES.has(mimeType)) {
      await assertSafeOoxml(buffer);
    }
    const processed = await runWorker<ProcessedDocument>(
      PARSE_WORKER,
      { bytes: buffer, mimeType, fileName },
      {
        timeoutMs: DOCUMENT_PROCESSING_TIMEOUT_MS,
        maxOldGenerationSizeMb: DOCUMENT_PROCESSING_MAX_HEAP_MB,
      },
    );
    return { ...processed, mimeType };
  }
}

export * from "./base.processor";
