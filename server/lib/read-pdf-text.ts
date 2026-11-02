import { PDFParse } from "pdf-parse";

/** The text layer of the first `maxPages` pages, and the document's page count. */
export async function readPdfText(
  buffer: Buffer,
  maxPages: number,
): Promise<{ text: string; pageCount: number }> {
  const parser = new PDFParse({ data: buffer });
  try {
    // No "-- 1 of N --" markers: the text goes into documents and embeddings as is.
    const result = await parser.getText({ first: maxPages, pageJoiner: "" });
    return { text: result.text, pageCount: result.total };
  } finally {
    await parser.destroy();
  }
}
