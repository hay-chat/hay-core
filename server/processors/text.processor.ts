import { BaseProcessor } from "./base.processor";
import type { ProcessedDocument } from "./base.processor";

export class TextProcessor extends BaseProcessor {
  supportedTypes = ["txt", "text/plain", "md", "markdown", "text/markdown"];

  async process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    const content = buffer.toString("utf-8");

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
