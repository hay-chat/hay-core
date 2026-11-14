import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import sharp from "sharp";

jest.mock("@server/lib/logger", () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { createLogger: () => ({ ...log, child: () => log }) };
});

// The network: a fake site served from a map of URL → response.
const site = new Map<string, { status: number; body?: Buffer | string; location?: string }>();
const mockSafeFetch = jest.fn(async (url: string | URL) => {
  const entry = site.get(String(url));
  if (!entry) return new Response(null, { status: 404 });
  const headers = entry.location ? { location: entry.location } : undefined;
  const body = entry.body === undefined ? null : new Uint8Array(Buffer.from(entry.body));
  return new Response(body, { status: entry.status, headers });
});
jest.mock("@server/utils/ssrf", () => ({ safeFetch: mockSafeFetch }));

interface Row {
  logoSource: "website" | "custom" | null;
  brandColorSource: "website" | "custom" | null;
}
let row: Row;
const mockPatch = jest.fn(async (_orgId: string, _data: Record<string, unknown>) => undefined);
const mockApplyColors = jest.fn(async (_orgId: string, _palette: string[]) => undefined);
const mockApplyLogo = jest.fn(async (_orgId: string, _uploadId: string) => ({
  applied: true,
  previousUploadId: "old-upload" as string | null,
}));
jest.mock("@server/repositories/webchat-settings.repository", () => ({
  webchatSettingsRepository: {
    getOrCreate: async () => row,
    patch: mockPatch,
    applyImportedColors: mockApplyColors,
    applyImportedLogo: mockApplyLogo,
  },
}));

const mockUpload = jest.fn(async (_options: { buffer: Buffer; folder: string }) => ({
  upload: { id: "new-upload" },
  url: "https://cdn/new.png",
}));
const mockDelete = jest.fn(async (_id: string) => undefined);
jest.mock("@server/services/storage.service", () => ({
  storageService: { upload: mockUpload, delete: mockDelete },
}));

import { brandingImportService } from "@server/services/branding-import/branding-import.service";

const ORG = "org-1";

async function png(size: number, r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

beforeEach(() => {
  jest.clearAllMocks();
  site.clear();
  row = { logoSource: null, brandColorSource: null };
});

describe("brandingImportService.importFromWebsite", () => {
  it("uses the best icon as the logo and its colours as the palette", async () => {
    site.set("https://shop.example.com/", {
      status: 301,
      location: "https://www.shop.example.com/",
    });
    site.set("https://www.shop.example.com/", {
      status: 200,
      body: `<head>
        <link rel="icon" href="/favicon-16.png" sizes="16x16">
        <link rel="apple-touch-icon" href="/apple.png">
      </head>`,
    });
    site.set("https://www.shop.example.com/apple.png", {
      status: 200,
      body: await png(180, 16, 185, 129),
    });

    await brandingImportService.importFromWebsite(ORG, "https://shop.example.com");

    expect(mockPatch).toHaveBeenCalledWith(ORG, { brandingImportedAt: expect.any(Date) });
    expect(mockApplyColors).toHaveBeenCalledWith(ORG, ["#10b981"]);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "organizations", mimeType: "image/png" }),
    );
    expect(mockApplyLogo).toHaveBeenCalledWith(ORG, "new-upload");
    expect(mockDelete).toHaveBeenCalledWith("old-upload");
  });

  it("keeps a logo the merchant uploaded, but still refreshes the palette", async () => {
    row = { logoSource: "custom", brandColorSource: "custom" };
    site.set("https://shop.example.com/", {
      status: 200,
      body: `<link rel="icon" type="image/svg+xml" href="/logo.svg">`,
    });
    site.set("https://shop.example.com/logo.svg", {
      status: 200,
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#8b5cf6"/></svg>`,
    });

    await brandingImportService.importFromWebsite(ORG, "https://shop.example.com");

    expect(mockApplyColors).toHaveBeenCalledWith(ORG, ["#8b5cf6"]);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockApplyLogo).not.toHaveBeenCalled();
  });

  it("only takes colours from a tiny favicon, falling back to /favicon.ico when the page fails", async () => {
    site.set("https://shop.example.com/", { status: 500 });
    site.set("https://shop.example.com/favicon.ico", {
      status: 200,
      body: await png(16, 230, 57, 70),
    });

    await brandingImportService.importFromWebsite(ORG, "shop.example.com");

    expect(mockApplyColors).toHaveBeenCalledWith(ORG, ["#e63946"]);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("drops the new upload when the merchant set a logo during the import", async () => {
    mockApplyLogo.mockResolvedValueOnce({ applied: false, previousUploadId: null });
    site.set("https://shop.example.com/", { status: 200, body: "<head></head>" });
    site.set("https://shop.example.com/favicon.ico", {
      status: 200,
      body: await png(64, 0, 29, 245),
    });

    await brandingImportService.importFromWebsite(ORG, "https://shop.example.com");

    expect(mockDelete).toHaveBeenCalledWith("new-upload");
  });

  it("refuses oversized icons and fails silently when nothing is usable", async () => {
    site.set("https://shop.example.com/", {
      status: 200,
      body: `<link rel="apple-touch-icon" href="/huge.png">`,
    });
    site.set("https://shop.example.com/huge.png", {
      status: 200,
      body: Buffer.alloc(2 * 1024 * 1024, 1),
    });

    await expect(
      brandingImportService.importFromWebsite(ORG, "https://shop.example.com"),
    ).resolves.toBeUndefined();
    expect(mockApplyColors).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });
});
