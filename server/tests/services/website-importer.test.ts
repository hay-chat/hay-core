import { describe, it, expect, beforeEach, jest } from "@jest/globals";

/**
 * Unit tests for the built-in WebsiteImporter. All I/O collaborators
 * (web scraper, HTML processor, headless browser, SSRF guard) are mocked so
 * these tests exercise only the importer's own logic: cursor pagination,
 * lastmod -> externalUpdatedAt mapping, sitemap-first vs crawl fallback, and
 * listChanges freshness filtering.
 */

// --- Mocks for the importer's collaborators -------------------------------

const mockGetSitemapEntries = jest.fn();
const mockFetchPageContent = jest.fn();
const mockDiscoverUrls = jest.fn();

jest.mock("@server/services/web-scraper.service", () => ({
  WebScraperService: jest.fn().mockImplementation(() => ({
    getSitemapEntries: mockGetSitemapEntries,
    fetchPageContent: mockFetchPageContent,
    discoverUrls: mockDiscoverUrls,
  })),
}));

const mockProcess = jest.fn();
jest.mock("@server/processors/html.processor", () => ({
  HtmlProcessor: jest.fn().mockImplementation(() => ({
    process: mockProcess,
  })),
}));

const mockRenderPage = jest.fn();
jest.mock("@server/services/headless-browser.service", () => ({
  headlessBrowserService: { renderPage: mockRenderPage },
}));

const mockIsExtractionPoor = jest.fn();
jest.mock("@server/utils/extraction-quality", () => ({
  isExtractionPoor: (...args: unknown[]) => mockIsExtractionPoor(...args),
}));

const mockValidateUrlForSSRF = jest.fn();
jest.mock("@server/utils/ssrf", () => ({
  validateUrlForSSRF: (...args: unknown[]) => mockValidateUrlForSSRF(...args),
}));

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { WebsiteImporter } from "@server/services/importers/website-importer";
import type { DocumentSource } from "@server/entities/document-source.entity";

function makeSource(url = "https://docs.example.com"): DocumentSource {
  return {
    id: "src-1",
    organizationId: "org-1",
    config: { url },
    externalRootId: url,
  } as unknown as DocumentSource;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateUrlForSSRF.mockResolvedValue(undefined);
  mockIsExtractionPoor.mockReturnValue(false);
});

describe("WebsiteImporter.discover", () => {
  it("paginates sitemap entries with an offset cursor and maps lastmod to externalUpdatedAt", async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      url: `https://docs.example.com/page-${i}`,
      lastmod: "2026-01-15T10:00:00.000Z",
    }));
    mockGetSitemapEntries.mockResolvedValue(entries);

    const importer = new WebsiteImporter(makeSource());

    const first = await importer.discover({ cursor: undefined });
    expect(first.pages).toHaveLength(50);
    expect(first.nextCursor).toBe("50");
    expect(first.total).toBe(60); // full enumeration count, for "X of Y" progress
    expect(first.pages[0]).toMatchObject({
      externalId: "https://docs.example.com/page-0",
      externalUrl: "https://docs.example.com/page-0",
      externalUpdatedAt: "2026-01-15T10:00:00.000Z",
    });

    const second = await importer.discover({ cursor: first.nextCursor });
    expect(second.pages).toHaveLength(10);
    expect(second.nextCursor).toBeUndefined();

    // Enumeration is cached for the importer's lifetime: the sitemap is fetched once.
    expect(mockGetSitemapEntries).toHaveBeenCalledTimes(1);
  });

  it("falls back to a bounded crawl when no sitemap is present", async () => {
    mockGetSitemapEntries.mockResolvedValue([]);
    mockDiscoverUrls.mockResolvedValue([
      { url: "https://docs.example.com/a", title: "A" },
      { url: "https://docs.example.com/b", title: "B" },
    ]);

    const importer = new WebsiteImporter(makeSource());
    const result = await importer.discover({ cursor: undefined });

    expect(mockDiscoverUrls).toHaveBeenCalledWith("https://docs.example.com");
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]).toMatchObject({ externalId: "https://docs.example.com/a", title: "A" });
    // No lastmod available from a crawl, so externalUpdatedAt is a valid ISO timestamp.
    expect(() => new Date(result.pages[0].externalUpdatedAt).toISOString()).not.toThrow();
  });
});

describe("WebsiteImporter.fetchPage", () => {
  it("converts HTML to markdown and derives externalUpdatedAt from the Last-Modified header", async () => {
    mockFetchPageContent.mockResolvedValue({
      url: "https://docs.example.com/page-1",
      title: "Page One",
      html: "<html><body><h1>Hi</h1></body></html>",
      lastModified: "Wed, 15 Jan 2026 10:00:00 GMT",
    });
    mockProcess.mockResolvedValue({ content: "# Hi", metadata: {} });

    const importer = new WebsiteImporter(makeSource());
    const fetched = await importer.fetchPage({
      externalId: "https://docs.example.com/page-1",
    });

    expect(mockValidateUrlForSSRF).toHaveBeenCalledWith("https://docs.example.com/page-1");
    expect(fetched.markdown).toBe("# Hi");
    expect(fetched.title).toBe("Page One");
    expect(fetched.externalUpdatedAt).toBe(new Date("Wed, 15 Jan 2026 10:00:00 GMT").toISOString());
    expect(mockRenderPage).not.toHaveBeenCalled();
  });

  it("re-renders with the headless browser when static extraction is poor", async () => {
    mockFetchPageContent.mockResolvedValue({
      url: "https://docs.example.com/spa",
      title: "SPA",
      html: "<html><body></body></html>",
    });
    // First extraction poor, second (rendered) good.
    mockIsExtractionPoor.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mockProcess
      .mockResolvedValueOnce({ content: "", metadata: {} })
      .mockResolvedValueOnce({ content: "# Rendered", metadata: {} });
    mockRenderPage.mockResolvedValue("<html><body><h1>Rendered</h1></body></html>");

    const importer = new WebsiteImporter(makeSource());
    const fetched = await importer.fetchPage({
      externalId: "https://docs.example.com/spa",
    });

    expect(mockRenderPage).toHaveBeenCalledWith("https://docs.example.com/spa");
    expect(fetched.markdown).toBe("# Rendered");
  });
});

describe("WebsiteImporter.listChanges", () => {
  it("returns only entries modified after `since`, plus entries with no lastmod", async () => {
    mockGetSitemapEntries.mockResolvedValue([
      { url: "https://docs.example.com/old", lastmod: "2026-01-01T00:00:00.000Z" },
      { url: "https://docs.example.com/new", lastmod: "2026-02-01T00:00:00.000Z" },
      { url: "https://docs.example.com/unknown" }, // no lastmod -> always considered changed
    ]);

    const importer = new WebsiteImporter(makeSource());
    const result = await importer.listChanges({
      since: "2026-01-15T00:00:00.000Z",
    });

    const ids = result.changes.map((c) => c.externalId);
    expect(ids).toContain("https://docs.example.com/new");
    expect(ids).toContain("https://docs.example.com/unknown");
    expect(ids).not.toContain("https://docs.example.com/old");
    expect(result.changes.every((c) => c.op === "upsert")).toBe(true);
  });
});
