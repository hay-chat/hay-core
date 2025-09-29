import { PdfProcessor } from "./pdf.processor";
import { TextProcessor } from "./text.processor";
import { HtmlProcessor } from "./html.processor";
import { WordProcessor } from "./word.processor";
import { PptxProcessor } from "./pptx.processor";
import { BaseProcessor } from "./base.processor";

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

  async processDocument(buffer: Buffer, mimeType: string, fileName?: string) {
    const processor = this.getProcessor(mimeType);
    if (!processor) {
      // Default to text processor for unknown types
      return new TextProcessor().process(buffer, fileName);
    }
    return processor.process(buffer, fileName);
  }
}

export * from "./base.processor";
