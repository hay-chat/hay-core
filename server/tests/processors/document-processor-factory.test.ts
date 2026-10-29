import { describe, it, expect, jest } from "@jest/globals";
import JSZip from "jszip";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import {
  DocumentProcessorFactory,
  DocumentRejectedError,
  MAX_OOXML_UNCOMPRESSED_BYTES,
  detectDocumentType,
} from "@server/processors";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function pptx(extra: Record<string, string | Buffer> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:a="a" xmlns:p="p"><a:t>Hello slide</a:t></p:sld>',
  );
  for (const [name, data] of Object.entries(extra)) zip.file(name, data);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("detectDocumentType", () => {
  it("uses the content, not the declared type", async () => {
    await expect(detectDocumentType(await pptx(), "text/plain")).resolves.toBe(PPTX);
    await expect(detectDocumentType(Buffer.from("plain"), "application/pdf")).resolves.toBe(
      "text/plain",
    );
    await expect(detectDocumentType(Buffer.from("<p>x</p>"), "text/html")).resolves.toBe(
      "text/html",
    );
  });

  it("refuses binary formats that are not documents", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await expect(detectDocumentType(png, "application/pdf")).rejects.toBeInstanceOf(
      DocumentRejectedError,
    );
  });

  it("keeps a declared OOXML type for a package seen as a plain ZIP", async () => {
    const zip = new JSZip();
    zip.file("docProps/core.xml", "<x/>");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(detectDocumentType(buffer, DOCX)).resolves.toBe(DOCX);
    await expect(detectDocumentType(buffer, "application/pdf")).rejects.toBeInstanceOf(
      DocumentRejectedError,
    );
  });
});

describe("DocumentProcessorFactory.processDocument", () => {
  const factory = new DocumentProcessorFactory();

  it("processes a presentation picked by content", async () => {
    const result = await factory.processDocument(await pptx(), "application/octet-stream");
    expect(result.mimeType).toBe(PPTX);
    expect(result.content).toContain("Hello slide");
  });

  it("refuses macro-enabled packages", async () => {
    const buffer = await pptx({ "ppt/vbaProject.bin": Buffer.from("macro") });
    await expect(factory.processDocument(buffer, PPTX)).rejects.toThrow(/Macro-enabled/);
  });

  it("refuses packages that inflate past the cap", async () => {
    const buffer = await pptx({
      "ppt/media/big.bin": Buffer.alloc(MAX_OOXML_UNCOMPRESSED_BYTES + 1),
    });
    expect(buffer.length).toBeLessThan(1024 * 1024);
    await expect(factory.processDocument(buffer, PPTX)).rejects.toThrow(/too large/);
  });
});
