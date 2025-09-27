import { BaseProcessor, type ProcessedDocument } from "./base.processor";
import * as mammoth from "mammoth";
import { sanitizeContent } from "../utils/sanitize";
const WordExtractor = require("word-extractor");

export class WordProcessor extends BaseProcessor {
  supportedTypes = [
    "application/msword", // .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    "application/vnd.ms-word.document.macroEnabled.12", // .docm
    "application/vnd.ms-word.template.macroEnabled.12", // .dotm
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template", // .dotx
  ];

  private wordExtractor = new WordExtractor();

  async process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    try {
      // Determine if it's a .doc or .docx based on file extension or buffer signature
      const isDocx = this.isDocxFile(buffer, fileName);

      if (isDocx) {
        return await this.processDocx(buffer, fileName);
      } else {
        return await this.processDoc(buffer, fileName);
      }
    } catch (error) {
      console.error(`Error processing Word document ${fileName}:`, error);
      throw new Error(`Failed to process Word document: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async processDocx(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    try {
      // Use mammoth for .docx files
      const result = await mammoth.extractRawText({ buffer });

      // Also get messages/warnings if any
      const fullResult = await mammoth.convertToHtml({ buffer });

      return {
        content: sanitizeContent(result.value || ""),
        metadata: {
          fileName,
          fileType: "docx",
          messages: fullResult.messages,
        },
      };
    } catch (error) {
      console.error("Error processing DOCX with mammoth:", error);
      // Fallback to word-extractor if mammoth fails
      return await this.processWithWordExtractor(buffer, fileName);
    }
  }

  private async processDoc(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    // Use word-extractor for .doc files
    return await this.processWithWordExtractor(buffer, fileName);
  }

  private async processWithWordExtractor(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    try {
      const doc = await this.wordExtractor.extract(buffer);

      // Combine all text sections
      const content = [
        doc.getBody(),
        doc.getFootnotes(),
        doc.getHeaders(),
        doc.getFooters(),
        doc.getEndnotes(),
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        content: sanitizeContent(content || ""),
        metadata: {
          fileName,
          fileType: this.detectFileType(buffer, fileName),
          annotations: doc.getAnnotations(),
        },
      };
    } catch (error) {
      console.error("Error processing with word-extractor:", error);
      throw error;
    }
  }

  private isDocxFile(buffer: Buffer, fileName?: string): boolean {
    // Check file extension first
    if (fileName) {
      const ext = fileName.toLowerCase().split(".").pop();
      if (ext === "docx" || ext === "docm" || ext === "dotx" || ext === "dotm") {
        return true;
      }
      if (ext === "doc" || ext === "dot") {
        return false;
      }
    }

    // Check file signature (magic numbers)
    // DOCX files start with PK (50 4B) as they are ZIP archives
    // DOC files start with D0 CF 11 E0 A1 B1 1A E1 (OLE2 format)
    if (buffer.length >= 4) {
      const signature = buffer.slice(0, 4).toString("hex").toUpperCase();
      if (signature.startsWith("504B")) {
        // PK signature - likely DOCX
        return true;
      } else if (signature.startsWith("D0CF11E0")) {
        // OLE2 signature - likely DOC
        return false;
      }
    }

    // Default to DOCX for modern documents
    return true;
  }

  private detectFileType(buffer: Buffer, fileName?: string): string {
    if (this.isDocxFile(buffer, fileName)) {
      return "docx";
    }
    return "doc";
  }
}