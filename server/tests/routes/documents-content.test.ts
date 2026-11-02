import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Documents written from the editor are rendered as HTML, so whatever field
 * carries their content is sanitized before it is stored.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

type StoredDocument = Record<string, unknown> & { id: string; organizationId: string };
let existing: StoredDocument | null;
const mockCreate = jest.fn(async (data: Record<string, unknown>) => ({ id: "doc-1", ...data }));
const mockUpdate = jest.fn(
  async (id: string, _organizationId: string, data: Record<string, unknown>) => ({
    ...existing,
    id,
    ...data,
  }),
);
jest.mock("@server/repositories/document.repository", () => ({
  documentRepository: {
    create: (data: Record<string, unknown>) => mockCreate(data),
    update: (id: string, organizationId: string, data: Record<string, unknown>) =>
      mockUpdate(id, organizationId, data),
    findByIdAndOrganization: async (id: string, organizationId: string) =>
      existing && existing.id === id && existing.organizationId === organizationId
        ? existing
        : null,
  },
}));
jest.mock("@server/services/vector-store.service", () => ({
  vectorStoreService: {
    initialized: true,
    addChunks: async () => [],
    deleteByDocumentId: async () => 0,
  },
}));
const mockStorageUpload = jest.fn<(options: Record<string, unknown>) => Promise<unknown>>();
jest.mock("@server/services/storage.service", () => ({
  storageService: { upload: mockStorageUpload },
}));
const mockUploadFind = jest.fn<(options: unknown) => Promise<Array<{ id: string }>>>();
jest.mock("@server/entities/upload.entity", () => ({
  Upload: { find: (options: unknown) => mockUploadFind(options) },
}));
const mockRunWorker = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@server/processors/run-worker", () => ({
  runWorker: (...args: unknown[]) => mockRunWorker(...args),
}));

import { documentsRouter } from "@server/routes/v1/documents";
import type { Context } from "@server/trpc/context";
import { DocumentRejectedError } from "@server/processors";
import { mediaUrl, verifyMediaSignature } from "@server/services/media-url.service";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ctx = {
  user: { id: "user-1", hasScope: () => true, getRole: () => "owner" },
  organizationId: ORG_ID,
  req: { headers: {} },
  res: {},
} as unknown as Context;
const caller = () => documentsRouter.createCaller(ctx);

const PAYLOAD = '<p>Hi</p><img src="x" onerror="alert(1)"><script>alert(2)</script>';

describe("editor document content", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    existing = {
      id: "doc-1",
      organizationId: ORG_ID,
      importMethod: "editor",
      content: "<p>old</p>",
    };
  });

  it("sanitizes content on update when no contentHtml is sent", async () => {
    await caller().update({ id: "doc-1", content: PAYLOAD });

    const stored = mockUpdate.mock.calls[0][2].content as string;
    expect(stored).toContain("<p>Hi</p>");
    expect(stored).not.toMatch(/onerror|<script/);
  });

  it("sanitizes contentHtml on update", async () => {
    await caller().update({ id: "doc-1", content: "ignored", contentHtml: PAYLOAD });

    const stored = mockUpdate.mock.calls[0][2].content as string;
    expect(stored).not.toMatch(/onerror|<script/);
  });

  it("keeps markdown content of non-editor documents as is", async () => {
    existing = { ...existing!, importMethod: "upload" };
    await caller().update({ id: "doc-1", content: "# Title\n\n<b>x</b>" });

    expect(mockUpdate.mock.calls[0][2].content).toBe("# Title\n\n<b>x</b>");
  });

  it("does not update a document owned by another organization", async () => {
    existing = { ...existing!, organizationId: "22222222-2222-4222-8222-222222222222" };

    await expect(caller().update({ id: "doc-1", content: "x" })).rejects.toThrow(
      "Document not found",
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("sanitizes content on create when no contentHtml is sent", async () => {
    await caller().create({ title: "T", content: PAYLOAD, contentJson: { type: "doc" } });

    const stored = mockCreate.mock.calls[0][0].content as string;
    expect(stored).toContain("<p>Hi</p>");
    expect(stored).not.toMatch(/onerror|<script/);
  });
});

describe("document file uploads", () => {
  beforeEach(() => jest.clearAllMocks());

  const createWithFile = (buffer: Buffer, mimeType: string, fileName: string) =>
    caller().create({
      title: "T",
      content: "",
      fileBuffer: buffer.toString("base64"),
      mimeType,
      fileName,
    });

  it("refuses a file larger than the upload limit before processing it", async () => {
    await expect(
      createWithFile(Buffer.alloc(11 * 1024 * 1024, "a"), "text/plain", "big.txt"),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses binary content whose type is not a supported document", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await expect(createWithFile(png, "application/pdf", "doc.pdf")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("fails the request cleanly when parsing is stopped", async () => {
    mockRunWorker.mockRejectedValue(new DocumentRejectedError("Document took too long to process"));

    await expect(
      createWithFile(Buffer.from("hello"), "text/plain", "notes.txt"),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Document took too long to process",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("stores the file under the detected type", async () => {
    mockRunWorker.mockResolvedValue({ content: "hello", metadata: {} });
    mockStorageUpload.mockResolvedValue({
      upload: { id: "u1", mimeType: "text/plain" },
      url: "https://api.test/v1/media/u1",
    });
    await createWithFile(Buffer.from("hello"), "text/plain", "notes.txt");

    expect(mockStorageUpload.mock.calls[0][0].mimeType).toBe("text/plain");
    expect(mockCreate.mock.calls[0][0].attachments).toEqual([
      expect.objectContaining({ type: "text/plain" }),
    ]);
  });
});

describe("document images", () => {
  const IMAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const signedQuery = /\?expires=\d+&(amp;)?sig=[\w-]+/;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadFind.mockResolvedValue([{ id: IMAGE_ID }]);
  });

  it("stores uploaded images in the private folder and returns a signed URL", async () => {
    mockStorageUpload.mockResolvedValue({
      upload: { id: IMAGE_ID },
      url: mediaUrl(IMAGE_ID),
    });

    const { url } = await caller().uploadImage({
      fileBuffer: Buffer.from("png").toString("base64"),
      mimeType: "image/png",
      fileName: "a.png",
    });

    expect(mockStorageUpload.mock.calls[0][0].folder).toBe("document-images");
    expect(url.startsWith(`${mediaUrl(IMAGE_ID)}?`)).toBe(true);
    const query = new URLSearchParams(url.split("?")[1]);
    expect(verifyMediaSignature(IMAGE_ID, query.get("expires"), query.get("sig"))).toBe(true);
  });

  it("stores the stable URL, never a signature", async () => {
    existing = { id: "doc-1", organizationId: ORG_ID, importMethod: "editor" };
    const signed = `${mediaUrl(IMAGE_ID)}?expires=99&sig=abc`;

    await caller().update({
      id: "doc-1",
      contentHtml: `<p>x</p><img src="${signed}">`,
      contentJson: { type: "doc", content: [{ type: "image", attrs: { src: signed } }] },
    });

    const data = mockUpdate.mock.calls[0][2];
    expect(data.content).toContain(`src="${mediaUrl(IMAGE_ID)}"`);
    expect(data.content).not.toMatch(signedQuery);
    expect(JSON.stringify(data.contentJson)).not.toMatch(signedQuery);
  });

  it("signs image URLs when the document is read", async () => {
    const DOCUMENT_ID = "11111111-1111-4111-8111-111111111112";
    existing = {
      id: DOCUMENT_ID,
      organizationId: ORG_ID,
      content: `<img src="${mediaUrl(IMAGE_ID)}">`,
      contentJson: {
        type: "doc",
        content: [{ type: "image", attrs: { src: mediaUrl(IMAGE_ID) } }],
      },
    };

    const document = await caller().getById({ id: DOCUMENT_ID });

    expect(document.content).toMatch(signedQuery);
    expect(JSON.stringify(document.contentJson)).toMatch(signedQuery);
  });
});
