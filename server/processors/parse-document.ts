import { PdfProcessor } from "./pdf.processor";
import { TextProcessor } from "./text.processor";
import { HtmlProcessor } from "./html.processor";
import { WordProcessor } from "./word.processor";
import { PptxProcessor } from "./pptx.processor";
import type { BaseProcessor, ProcessedDocument } from "./base.processor";

const PROCESSORS: BaseProcessor[] = [
  new PdfProcessor(),
  new TextProcessor(),
  new HtmlProcessor(),
  new WordProcessor(),
  new PptxProcessor(),
];

/** Parse a document whose type was already detected. Runs inside the parse worker. */
export function parseDocument(
  buffer: Buffer,
  mimeType: string,
  fileName?: string,
): Promise<ProcessedDocument> {
  const processor = PROCESSORS.find((p) => p.canProcess(mimeType)) ?? new TextProcessor();
  return processor.process(buffer, fileName);
}
