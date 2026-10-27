import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { TRPCError } from "@trpc/server";

/**
 * GET /v1/media/:id — private upload access (signature or staff session) and
 * the response headers that keep stored files from rendering as active content.
 */

jest.mock("@server/config/env", () => ({
  config: { jwt: { secret: "media-route-test-secret" } },
  getApiUrl: () => "https://api.example.test",
}));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const mockFindOne = jest.fn<(options: unknown) => Promise<unknown>>();
jest.mock("@server/entities/upload.entity", () => ({ Upload: { findOne: mockFindOne } }));

const mockDownload = jest.fn<(id: string) => Promise<{ buffer: Buffer }>>();
jest.mock("@server/services/storage.service", () => ({
  storageService: { download: mockDownload },
}));

const mockRequireAuth = jest.fn<(req: unknown) => Promise<unknown>>();
jest.mock("@server/lib/auth/middleware", () => ({ requireAuth: mockRequireAuth }));

import express from "express";
import mediaRouter from "@server/routes/v1/media/index";
import { signMediaUrl } from "@server/services/media-url.service";

const UPLOAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";
const BYTES = Buffer.from("0123456789");

const upload = (overrides: Record<string, unknown> = {}) => ({
  id: UPLOAD_ID,
  organizationId: ORG_ID,
  folder: "conversation-media",
  mimeType: "image/jpeg",
  originalName: "foto ação.jpg",
  ...overrides,
});

const staff = (organizationId = ORG_ID, allowed = true) => ({
  organizationId,
  hasScope: jest.fn((_resource: string, _action: string) => allowed),
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use("/v1/media", mediaRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOne.mockResolvedValue(upload());
  mockDownload.mockResolvedValue({ buffer: BYTES });
});

const signedPath = (id = UPLOAD_ID, ttl = 60) => {
  const url = new URL(signMediaUrl(id, ttl));
  return `${url.pathname}${url.search}`;
};

const staffHeaders = (organizationId = ORG_ID) => ({
  authorization: "Bearer token",
  "x-organization-id": organizationId,
});

describe("GET /v1/media/:id", () => {
  it("serves a signed URL with safe headers", async () => {
    const response = await fetch(`${baseUrl}${signedPath()}`);

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="foto a__o.jpg"; filename*=UTF-8''foto%20a%C3%A7%C3%A3o.jpg`,
    );
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it("forces a download for non-media types and SVG", async () => {
    mockFindOne.mockResolvedValue(upload({ mimeType: "application/pdf", originalName: "a.pdf" }));
    let response = await fetch(`${baseUrl}${signedPath()}`);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);

    mockFindOne.mockResolvedValue(upload({ mimeType: "image/svg+xml", originalName: "a.svg" }));
    response = await fetch(`${baseUrl}${signedPath()}`);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("answers 401 without credentials and 404 for a bad signature", async () => {
    expect((await fetch(`${baseUrl}/v1/media/${UPLOAD_ID}`)).status).toBe(401);

    const tampered = signedPath().replace(/sig=[^&]+/, "sig=AAAA");
    expect((await fetch(`${baseUrl}${tampered}`)).status).toBe(404);

    const expired = signedPath(UPLOAD_ID, -1);
    expect((await fetch(`${baseUrl}${expired}`)).status).toBe(404);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("does not accept another upload's signature", async () => {
    const otherId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const path = signedPath(otherId).replace(otherId, UPLOAD_ID);

    expect((await fetch(`${baseUrl}${path}`)).status).toBe(404);
  });

  it("serves staff of the upload's organization with conversation read access", async () => {
    const user = staff();
    mockRequireAuth.mockResolvedValue(user);

    const response = await fetch(`${baseUrl}/v1/media/${UPLOAD_ID}`, { headers: staffHeaders() });

    expect(response.status).toBe(200);
    expect(user.hasScope).toHaveBeenCalledWith("conversations", "read");
  });

  it("hides uploads of other organizations and from staff without access", async () => {
    mockRequireAuth.mockResolvedValue(staff(OTHER_ORG_ID));
    let response = await fetch(`${baseUrl}/v1/media/${UPLOAD_ID}`, {
      headers: staffHeaders(OTHER_ORG_ID),
    });
    expect(response.status).toBe(404);

    mockRequireAuth.mockResolvedValue(staff(ORG_ID, false));
    response = await fetch(`${baseUrl}/v1/media/${UPLOAD_ID}`, { headers: staffHeaders() });
    expect(response.status).toBe(404);

    mockRequireAuth.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "no" }));
    response = await fetch(`${baseUrl}/v1/media/${UPLOAD_ID}`, { headers: staffHeaders() });
    expect(response.status).toBe(404);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("answers 401 for an invalid session token", async () => {
    mockRequireAuth.mockRejectedValue(new TRPCError({ code: "UNAUTHORIZED", message: "bad" }));

    const response = await fetch(`${baseUrl}/v1/media/${UPLOAD_ID}`, { headers: staffHeaders() });

    expect(response.status).toBe(401);
  });

  it("returns 404 for unknown or malformed ids", async () => {
    mockFindOne.mockResolvedValue(null);
    expect((await fetch(`${baseUrl}${signedPath()}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/v1/media/not-a-uuid`)).status).toBe(404);
  });

  it("supports byte ranges for media players", async () => {
    const response = await fetch(`${baseUrl}${signedPath()}`, { headers: { range: "bytes=2-5" } });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("2345");

    const unsatisfiable = await fetch(`${baseUrl}${signedPath()}`, {
      headers: { range: "bytes=50-60" },
    });
    expect(unsatisfiable.status).toBe(416);
  });
});
