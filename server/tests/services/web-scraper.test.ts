/**
 * The website scraper never lets axios follow redirects: each hop is
 * SSRF-checked and pinned, pages only follow same-page normalizations, and
 * hidden markup is dropped from imported content.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { AxiosRequestConfig } from "axios";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockAxiosGet = jest.fn<(url: string, config: AxiosRequestConfig) => Promise<unknown>>();
jest.mock("axios", () => ({ __esModule: true, default: { get: mockAxiosGet } }));

const mockValidate = jest.fn<(url: string) => Promise<void>>(async () => undefined);
jest.mock("@server/utils/ssrf", () => {
  const actual = jest.requireActual<typeof import("@server/utils/ssrf")>("@server/utils/ssrf");
  return { ...actual, validateUrlForSSRF: (url: string) => mockValidate(url) };
});

import { WebScraperService, isSamePageRedirect } from "@server/services/web-scraper.service";
import { ssrfSafeHttpAgent, ssrfSafeHttpsAgent } from "@server/utils/ssrf";

function reply(status: number, data = "", headers: Record<string, string> = {}) {
  return { status, data, headers };
}

const PAGE_HTML =
  "<html><head><title>Help</title></head><body><p>Visible answer</p>" +
  '<div style="display: none">Hidden instructions</div>' +
  '<p hidden>Hidden paragraph</p><span aria-hidden="true">Decorative</span>' +
  "<template><p>Template text</p></template></body></html>";

beforeEach(() => {
  jest.clearAllMocks();
  mockValidate.mockResolvedValue(undefined);
});

describe("WebScraperService page fetches", () => {
  it("pins every request and never lets axios follow redirects", async () => {
    mockAxiosGet.mockResolvedValueOnce(reply(200, PAGE_HTML));
    await new WebScraperService().fetchPageContent("https://site.example/help");

    const config = mockAxiosGet.mock.calls[0][1];
    expect(config).toMatchObject({
      maxRedirects: 0,
      proxy: false,
      httpAgent: ssrfSafeHttpAgent,
      httpsAgent: ssrfSafeHttpsAgent,
    });
    expect(mockValidate).toHaveBeenCalledWith("https://site.example/help");
  });

  it("does not follow a redirect to another host", async () => {
    mockAxiosGet.mockResolvedValueOnce(
      reply(302, "", { location: "http://169.254.169.254/latest/meta-data/" }),
    );
    const page = await new WebScraperService().fetchPageContent("https://site.example/help");

    expect(page).toBeNull();
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockValidate).not.toHaveBeenCalledWith("http://169.254.169.254/latest/meta-data/");
  });

  it("does not follow a redirect to a different page on the same host", async () => {
    mockAxiosGet.mockResolvedValueOnce(reply(301, "", { location: "/login" }));
    const page = await new WebScraperService().fetchPageContent("https://site.example/help");

    expect(page).toBeNull();
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  it("follows a same-page normalization and re-checks the new hop", async () => {
    mockAxiosGet
      .mockResolvedValueOnce(reply(301, "", { location: "https://site.example/help/" }))
      .mockResolvedValueOnce(reply(200, PAGE_HTML));
    const page = await new WebScraperService().fetchPageContent("http://site.example/help");

    expect(page?.title).toBe("Help");
    expect(mockAxiosGet.mock.calls.map(([url]) => url)).toEqual([
      "http://site.example/help",
      "https://site.example/help/",
    ]);
    expect(mockValidate).toHaveBeenCalledWith("https://site.example/help/");
  });

  it("drops hidden markup from the imported text and HTML", async () => {
    mockAxiosGet.mockResolvedValueOnce(reply(200, PAGE_HTML));
    const page = await new WebScraperService().fetchPageContent("https://site.example/help");

    expect(page?.content).toContain("Visible answer");
    for (const hidden of ["Hidden instructions", "Hidden paragraph", "Decorative", "Template"]) {
      expect(page?.content).not.toContain(hidden);
      expect(page?.html).not.toContain(hidden);
    }
  });
});

describe("WebScraperService sitemap fetches", () => {
  const SITEMAP =
    '<?xml version="1.0"?><urlset><url><loc>https://site.example/a</loc></url></urlset>';

  it("follows a sitemap redirect to another host, checking each hop", async () => {
    mockAxiosGet
      .mockResolvedValueOnce(reply(301, "", { location: "https://cdn.example/sitemap.xml" }))
      .mockResolvedValueOnce(reply(200, SITEMAP));
    const entries = await new WebScraperService().getSitemapEntries("https://site.example/");

    expect(entries).toEqual([{ url: "https://site.example/a", lastmod: undefined }]);
    expect(mockValidate).toHaveBeenCalledWith("https://cdn.example/sitemap.xml");
    for (const [, config] of mockAxiosGet.mock.calls) {
      expect(config).toMatchObject({ maxRedirects: 0, httpsAgent: ssrfSafeHttpsAgent });
    }
  });

  it("never requests a redirect target that fails the SSRF check", async () => {
    mockAxiosGet.mockResolvedValue(reply(302, "", { location: "http://10.0.0.5/sitemap.xml" }));
    mockValidate.mockImplementation(async (url) => {
      if (url.startsWith("http://10.")) throw new Error("Blocked request to private/internal IP");
    });
    const entries = await new WebScraperService().getSitemapEntries("https://site.example/");

    expect(entries).toEqual([]);
    expect(mockAxiosGet.mock.calls.map(([url]) => url)).not.toContain(
      "http://10.0.0.5/sitemap.xml",
    );
  });

  it("stops after a bounded number of redirect hops", async () => {
    let hop = 0;
    mockAxiosGet.mockImplementation(async () =>
      reply(302, "", { location: `https://site.example/loop-${++hop}` }),
    );
    await new WebScraperService().getSitemapEntries("https://site.example/");

    // 5 sitemap paths, each at most 1 request + 5 followed redirects.
    expect(mockAxiosGet.mock.calls.length).toBeLessThanOrEqual(5 * 6);
  });
});

describe("isSamePageRedirect", () => {
  const same = (from: string, to: string) => isSamePageRedirect(new URL(from), new URL(to));

  it("allows scheme upgrades and trailing slashes only", () => {
    expect(same("http://a.example/x", "https://a.example/x")).toBe(true);
    expect(same("https://a.example/x", "https://a.example/x/")).toBe(true);
    expect(same("https://a.example/x", "https://b.example/x")).toBe(false);
    expect(same("https://a.example/x", "https://a.example/y")).toBe(false);
    expect(same("https://a.example/x?q=1", "https://a.example/x?q=2")).toBe(false);
  });
});
