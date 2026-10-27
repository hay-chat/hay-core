import { describe, it, expect, jest, beforeEach } from "@jest/globals";

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
