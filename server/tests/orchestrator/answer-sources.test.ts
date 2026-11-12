import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Sources under an AI answer (C3): only documents with a public URL are
 * linked for the shopper; internal documents and plugin-synced pages never are.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

const mockFindDocuments = jest.fn<(ids: string[], organizationId: string) => Promise<unknown[]>>();
jest.mock("@server/repositories/document.repository", () => ({
  documentRepository: {
    findByIdsAndOrganization: (ids: string[], organizationId: string) =>
      mockFindDocuments(ids, organizationId),
  },
}));
const mockFindSources = jest.fn<(organizationId: string) => Promise<unknown[]>>();
jest.mock("@server/repositories/document-source.repository", () => ({
  documentSourceRepository: {
    findByOrganization: (organizationId: string) => mockFindSources(organizationId),
  },
}));
jest.mock("@server/services/importers/website-importer", () => ({
  WEBSITE_PLUGIN_ID: "core:website",
}));

import { publicAnswerSources, publicDocumentUrl } from "@server/orchestrator/answer-sources";
import { DocumentVisibility, ImportMethod, type Document } from "@server/entities/document.entity";

const ORG_ID = "org-1";

const doc = (overrides: Partial<Document>): Document =>
  ({
    id: "d1",
    title: "Returns",
    visibility: DocumentVisibility.PRIVATE,
    importMethod: ImportMethod.UPLOAD,
    sourceUrl: undefined,
    externalUrl: undefined,
    documentSourceId: undefined,
    ...overrides,
  }) as Document;

describe("publicDocumentUrl", () => {
  const websiteSources = new Set(["src-web"]);

  it("links pages crawled from the store's website", () => {
    expect(
      publicDocumentUrl(
        doc({ documentSourceId: "src-web", externalUrl: "https://shop.example/returns" }),
        websiteSources,
      ),
    ).toBe("https://shop.example/returns");
    expect(
      publicDocumentUrl(
        doc({ importMethod: ImportMethod.WEB, sourceUrl: "https://shop.example/faq" }),
        websiteSources,
      ),
    ).toBe("https://shop.example/faq");
  });

  it("links a document the team marked public", () => {
    expect(
      publicDocumentUrl(
        doc({ visibility: DocumentVisibility.PUBLIC, externalUrl: "https://help.example/a" }),
        websiteSources,
      ),
    ).toBe("https://help.example/a");
  });

  it("never links internal documents, uploads or other plugin pages", () => {
    expect(
      publicDocumentUrl(
        doc({
          visibility: DocumentVisibility.INTERNAL,
          documentSourceId: "src-web",
          externalUrl: "https://shop.example/staff",
        }),
        websiteSources,
      ),
    ).toBeNull();
    expect(publicDocumentUrl(doc({}), websiteSources)).toBeNull();
    expect(
      publicDocumentUrl(
        doc({ documentSourceId: "src-notion", externalUrl: "https://notion.so/internal" }),
        websiteSources,
      ),
    ).toBeNull();
    expect(
      publicDocumentUrl(
        doc({ visibility: DocumentVisibility.PUBLIC, externalUrl: "ftp://x" }),
        websiteSources,
      ),
    ).toBeNull();
  });
});

describe("publicAnswerSources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindSources.mockResolvedValue([
      { id: "src-web", pluginId: "core:website" },
      { id: "src-notion", pluginId: "notion" },
    ]);
  });

  it("returns the public ones in the order the answer used them, once per URL", async () => {
    mockFindDocuments.mockResolvedValue([
      doc({
        id: "a",
        title: "Shipping",
        documentSourceId: "src-web",
        externalUrl: "https://s/ship",
      }),
      doc({ id: "b", title: "Wiki", documentSourceId: "src-notion", externalUrl: "https://n/w" }),
      doc({ id: "c", title: "Returns", documentSourceId: "src-web", externalUrl: "https://s/ret" }),
      doc({
        id: "d",
        title: "Returns copy",
        documentSourceId: "src-web",
        externalUrl: "https://s/ret",
      }),
    ]);

    const sources = await publicAnswerSources(ORG_ID, [
      { id: "c", title: "Returns" },
      { id: "tool:get_order", title: "Tool result" },
      { id: "b", title: "Wiki" },
      { id: "a", title: "Shipping" },
      { id: "d", title: "Returns copy" },
    ]);

    expect(mockFindDocuments).toHaveBeenCalledWith(["c", "tool:get_order", "b", "a", "d"], ORG_ID);
    expect(sources).toEqual([
      { title: "Returns", url: "https://s/ret" },
      { title: "Shipping", url: "https://s/ship" },
    ]);
  });

  it("is empty when nothing was used or nothing is public", async () => {
    expect(await publicAnswerSources(ORG_ID, undefined)).toEqual([]);
    expect(mockFindDocuments).not.toHaveBeenCalled();

    mockFindDocuments.mockResolvedValue([doc({ id: "a" })]);
    expect(await publicAnswerSources(ORG_ID, [{ id: "a" }])).toEqual([]);
  });

  it("never fails the answer when the lookup fails", async () => {
    mockFindDocuments.mockRejectedValue(new Error("db down"));
    expect(await publicAnswerSources(ORG_ID, [{ id: "a" }])).toEqual([]);
  });
});
