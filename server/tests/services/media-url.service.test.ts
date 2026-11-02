import { describe, it, expect, jest, beforeEach, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";

/**
 * media-url.service — signed URLs for private uploads.
 */

jest.mock("@server/config/env", () => ({
  config: { jwt: { secret: "media-url-test-secret" } },
  getApiUrl: () => "https://api.example.test",
}));

const mockFind = jest.fn<(options: unknown) => Promise<Array<{ id: string; folder: string }>>>();
jest.mock("@server/entities/upload.entity", () => ({ Upload: { find: mockFind } }));

import {
  isPublicUploadPath,
  mediaUrl,
  setPublicUploadHeaders,
  signAttachmentUrls,
  signMediaUrl,
  verifyMediaSignature,
} from "@server/services/media-url.service";

const UPLOAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

const parse = (url: string) => {
  const parsed = new URL(url);
  return {
    path: parsed.pathname,
    expires: parsed.searchParams.get("expires") ?? undefined,
    sig: parsed.searchParams.get("sig") ?? undefined,
  };
};

describe("signMediaUrl / verifyMediaSignature", () => {
  it("builds a /v1/media URL whose signature verifies until it expires", () => {
    const { path, expires, sig } = parse(signMediaUrl(UPLOAD_ID, 60, NOW));

    expect(path).toBe(`/v1/media/${UPLOAD_ID}`);
    expect(Number(expires)).toBe(NOW / 1000 + 60);
    expect(verifyMediaSignature(UPLOAD_ID, expires, sig, NOW)).toBe(true);
    expect(verifyMediaSignature(UPLOAD_ID, expires, sig, NOW + 60_000)).toBe(true);
    expect(verifyMediaSignature(UPLOAD_ID, expires, sig, NOW + 61_000)).toBe(false);
  });

  it("rejects a signature reused for another upload or a stretched expiry", () => {
    const { expires, sig } = parse(signMediaUrl(UPLOAD_ID, 60, NOW));

    expect(verifyMediaSignature(OTHER_ID, expires, sig, NOW)).toBe(false);
    expect(verifyMediaSignature(UPLOAD_ID, String(Number(expires) + 3600), sig, NOW)).toBe(false);
  });

  it("rejects malformed or missing parameters", () => {
    const { expires } = parse(signMediaUrl(UPLOAD_ID, 60, NOW));

    expect(verifyMediaSignature(UPLOAD_ID, expires, "short", NOW)).toBe(false);
    expect(verifyMediaSignature(UPLOAD_ID, expires, undefined, NOW)).toBe(false);
    expect(verifyMediaSignature(UPLOAD_ID, "12abc", "x", NOW)).toBe(false);
    expect(verifyMediaSignature(UPLOAD_ID, ["1", "2"], "x", NOW)).toBe(false);
  });

  it("unsigned media URL carries no credentials", () => {
    expect(mediaUrl(UPLOAD_ID)).toBe(`https://api.example.test/v1/media/${UPLOAD_ID}`);
  });
});

describe("isPublicUploadPath", () => {
  it("serves only public folders from local /uploads", () => {
    expect(isPublicUploadPath(`/${ORG_ID}/organizations/logo.png`)).toBe(true);
    expect(isPublicUploadPath(`/${ORG_ID}/avatars/a.png`)).toBe(true);
    expect(isPublicUploadPath(`/${ORG_ID}/document-images/i.png`)).toBe(true);
    expect(isPublicUploadPath(`/${ORG_ID}/conversation-media/photo.jpg`)).toBe(false);
    expect(isPublicUploadPath(`/${ORG_ID}/plugin-zips/p/x.zip`)).toBe(false);
    expect(isPublicUploadPath(`/${ORG_ID}/documents/${ORG_ID}/d.pdf`)).toBe(false);
    expect(isPublicUploadPath(`/organizations`)).toBe(false);
  });

  it.each([
    `/${ORG_ID}/organizations/../conversation-media/a.txt`,
    `/${ORG_ID}/organizations/%2e%2e/conversation-media/a.txt`,
    `/${ORG_ID}/organizations/%2E%2E/conversation-media/a.txt`,
    `/${ORG_ID}/organizations/.%2e/conversation-media/a.txt`,
    `/${ORG_ID}/organizations%2f..%2fconversation-media/a.txt`,
    `/${ORG_ID}/avatars/../../${ORG_ID}/conversation-media/a.txt`,
    `/${ORG_ID}/organizations/..%5cconversation-media/a.txt`,
    `/${ORG_ID}/organizations/a%00.png`,
    `/${ORG_ID}/organizations/%E0%A4%A`,
  ])("refuses a path that could step out of its public folder: %s", (requestPath) => {
    expect(isPublicUploadPath(requestPath)).toBe(false);
  });

  it("still serves encoded file names inside a public folder", () => {
    expect(isPublicUploadPath(`/${ORG_ID}/organizations/my%20logo.png`)).toBe(true);
    expect(isPublicUploadPath(`/${ORG_ID}/organizations/./logo.png`)).toBe(true);
  });
});

describe("/uploads gate in front of express.static", () => {
  let server: http.Server;
  let port: number;
  let root: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-gate-"));
    fs.mkdirSync(path.join(root, ORG_ID, "organizations"), { recursive: true });
    fs.mkdirSync(path.join(root, ORG_ID, "conversation-media"), { recursive: true });
    fs.writeFileSync(path.join(root, ORG_ID, "organizations", "logo.png"), "public");
    fs.writeFileSync(path.join(root, ORG_ID, "organizations", "logo.svg"), "<svg/>");
    fs.writeFileSync(path.join(root, ORG_ID, "conversation-media", "a.txt"), "private");

    // Same wiring as server/main.ts.
    const app = express();
    app.use(
      "/uploads",
      (req, res, next) => (isPublicUploadPath(req.path) ? next() : res.status(404).end()),
      express.static(root, { setHeaders: setPublicUploadHeaders }),
    );
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Raw request so the client does not normalise `..` before sending.
  const request = (rawPath: string) =>
    new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>(
      (resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: rawPath, method: "GET" },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, body, headers: res.headers }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
  const get = async (rawPath: string) => {
    const { status, body } = await request(rawPath);
    return { status, body };
  };

  it("serves raster images inline and anything else as a sandboxed download", async () => {
    const png = await request(`/uploads/${ORG_ID}/organizations/logo.png`);
    expect(png.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(png.headers["content-disposition"]).toBeUndefined();

    const svg = await request(`/uploads/${ORG_ID}/organizations/logo.svg`);
    expect(svg.status).toBe(200);
    expect(svg.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(svg.headers["content-disposition"]).toBe("attachment");
    expect(svg.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves a public file", async () => {
    await expect(get(`/uploads/${ORG_ID}/organizations/logo.png`)).resolves.toEqual({
      status: 200,
      body: "public",
    });
  });

  it.each([
    `/uploads/${ORG_ID}/organizations/../conversation-media/a.txt`,
    `/uploads/${ORG_ID}/organizations/%2e%2e/conversation-media/a.txt`,
    `/uploads/${ORG_ID}/organizations/%2e%2e%2fconversation-media%2fa.txt`,
  ])("does not serve a private file through %s", async (rawPath) => {
    const response = await get(rawPath);
    expect(response.status).toBe(404);
    expect(response.body).not.toContain("private");
  });
});

describe("signAttachmentUrls", () => {
  beforeEach(() => jest.clearAllMocks());

  it("signs private uploads of the organization and leaves the rest alone", async () => {
    mockFind.mockResolvedValue([{ id: UPLOAD_ID, folder: "conversation-media" }]);
    const attachments = [
      { id: UPLOAD_ID, name: "p.jpg", url: "https://bucket.example/uploads/p.jpg" },
      { id: OTHER_ID, name: "q.jpg", url: "https://elsewhere.example/q.jpg" },
      { id: "not-a-uuid", name: "r.jpg", url: "https://cdn.example/r.jpg" },
    ];

    const signed = await signAttachmentUrls(attachments, ORG_ID, 900);

    expect(mockFind).toHaveBeenCalledTimes(1);
    const { path, expires, sig } = parse(signed[0].url);
    expect(path).toBe(`/v1/media/${UPLOAD_ID}`);
    expect(verifyMediaSignature(UPLOAD_ID, expires, sig)).toBe(true);
    expect(signed[1]).toEqual(attachments[1]);
    expect(signed[2]).toEqual(attachments[2]);
  });

  it("keeps direct URLs for uploads in public folders", async () => {
    mockFind.mockResolvedValue([{ id: UPLOAD_ID, folder: "document-images" }]);
    const attachments = [{ id: UPLOAD_ID, url: "https://bucket.example/img.png" }];

    expect(await signAttachmentUrls(attachments, ORG_ID, 900)).toEqual(attachments);
  });

  it("skips the lookup when no attachment is a Hay upload", async () => {
    const attachments = [{ id: "att-1", url: "https://cdn.example/x.jpg" }];

    expect(await signAttachmentUrls(attachments, ORG_ID, 900)).toBe(attachments);
    expect(mockFind).not.toHaveBeenCalled();
  });
});
