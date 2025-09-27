import pdfParse from "pdf-parse";
import { BaseProcessor } from "./base.processor";
import type { ProcessedDocument } from "./base.processor";
import { sanitizeContent } from "../utils/sanitize";

export class PdfProcessor extends BaseProcessor {
  supportedTypes = ["pdf", "application/pdf"];

  async process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    const data = await pdfParse(buffer);

    return {
      content: sanitizeContent(data.text),
      metadata: {
        fileName,
        fileType: "pdf",
        pageCount: data.numpages,
        info: data.info,
      },
    };
  }
}
