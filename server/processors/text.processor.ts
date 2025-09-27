import { BaseProcessor } from "./base.processor";
import type { ProcessedDocument } from "./base.processor";
import { sanitizeContent } from "../utils/sanitize";

export class TextProcessor extends BaseProcessor {
  supportedTypes = ["txt", "text/plain", "md", "markdown", "text/markdown"];

  async process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    const rawContent = buffer.toString("utf-8");
    const content = sanitizeContent(rawContent);

    return {
      content,
      metadata: {
        fileName,
        fileType: "text",
        characterCount: content.length,
      },
    };
  }
}
