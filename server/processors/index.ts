import FileType from "file-type";
import JSZip from "jszip";
import { PdfProcessor } from "./pdf.processor";
import { TextProcessor } from "./text.processor";
import { HtmlProcessor } from "./html.processor";
import { WordProcessor } from "./word.processor";
import { PptxProcessor } from "./pptx.processor";
import { BaseProcessor } from "./base.processor";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const OOXML_TYPES = new Set([DOCX, PPTX]);
/** Legacy Office files are OLE/CFB containers; the declared type says which one. */
const CFB_TYPES = new Set(["application/msword", "application/vnd.ms-powerpoint"]);
/** Text formats have no magic bytes; picked by the declared type when nothing binary is found. */
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/html", "application/xhtml+xml"]);

/** Total inflated size of an OOXML package, checked before any part is decompressed. */
export const MAX_OOXML_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
/**
 * Upper bound on one document's processing. Parsing runs on the main thread,
 * so this bounds the request, not the CPU work already started.
 * TODO: move document parsing to a worker thread so it can be stopped.
 */
export const DOCUMENT_PROCESSING_TIMEOUT_MS = 60_000;

export class DocumentRejectedError extends Error {}

/** Document type from the file's content; the declared type only breaks ties. */
export async function detectDocumentType(
  buffer: Buffer,
  declaredMimeType: string,
): Promise<string> {
  const declared = declaredMimeType.split(";")[0].trim().toLowerCase();
  const detected = await FileType.fromBuffer(buffer);

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DocumentRejectedError("Document took too long to process")),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class DocumentProcessorFactory {
  private processors: BaseProcessor[] = [
    new PdfProcessor(),
    new TextProcessor(),
    new HtmlProcessor(),
    new WordProcessor(),
    new PptxProcessor(),
  ];

  getProcessor(mimeType: string): BaseProcessor | null {
    const processor = this.processors.find((p) => p.canProcess(mimeType));
    return processor || null;
  }

  /**
   * Process an uploaded document. The caller checks the size first; the type
   * is detected from the content, never taken from the client.
   */
  async processDocument(buffer: Buffer, declaredMimeType: string, fileName?: string) {
    const mimeType = await detectDocumentType(buffer, declaredMimeType);
    if (OOXML_TYPES.has(mimeType)) {
      await assertSafeOoxml(buffer);
    }
    const processor = this.getProcessor(mimeType) ?? new TextProcessor();
    const processed = await withTimeout(
      processor.process(buffer, fileName),
      DOCUMENT_PROCESSING_TIMEOUT_MS,
    );
    return { ...processed, mimeType };
  }
}

export * from "./base.processor";
