import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * StorageService — uploads are private unless their folder is public.
 */

jest.mock("@server/config/env", () => ({
  config: {
    jwt: { secret: "storage-test-secret" },
    storage: {
      s3: {
        endpoint: "https://ams3.digitaloceanspaces.com",
        region: "ams3",
        bucket: "hay-test",
        accessKeyId: "key",
        secretAccessKey: "secret",
      },
      local: { uploadDir: "/tmp/hay-test-uploads", baseUrl: "http://localhost/uploads" },
      limits: {
        maxFileSize: 10 * 1024 * 1024,
        conversationMediaMaxFileSize: 25 * 1024 * 1024,
      },
      clamav: { host: null, port: 3310 },
    },
    plugins: { maxUploadSizeMB: 50 },
  },
  getApiUrl: () => "https://api.example.test",
}));

const mockS3Params: Array<Record<string, unknown>> = [];
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@aws-sdk/lib-storage", () => ({
  Upload: jest.fn((options: { params: Record<string, unknown> }) => {
    mockS3Params.push(options.params);
    return { done: async () => ({}) };
  }),
}));
const mockS3Send = jest.fn(async () => ({}));
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  DeleteObjectCommand: jest.fn(),
}));

const mockFindOne = jest.fn<(options: unknown) => Promise<Record<string, unknown> | null>>();

jest.mock("@server/entities/upload.entity", () => ({
  Upload: {
    findOne: (options: unknown) => mockFindOne(options),
    create: (fields: Record<string, unknown>) => ({
      ...fields,
      save: async function () {
        return { ...this, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
      },
    }),
  },
}));

import { StorageService } from "@server/services/storage.service";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("StorageService private uploads", () => {
  beforeEach(() => {
    mockS3Params.length = 0;
  });

  it("stores conversation media privately and returns the /v1/media URL", async () => {
    const result = await new StorageService().upload({
      buffer: PNG,
      originalName: "photo.png",
      mimeType: "image/png",
      folder: "conversation-media",
      organizationId: ORG_ID,
    });

    expect(mockS3Params[0].ACL).toBe("private");
    expect(result.url).toBe(`https://api.example.test/v1/media/${result.upload.id}`);
  });

  it("sanitises conversation media and names the file after its real type", async () => {
    const result = await new StorageService().upload({
      buffer: PNG,
      originalName: "photo.jpg",
      mimeType: "image/jpeg",
      folder: "conversation-media",
      organizationId: ORG_ID,
    });

    expect(result.upload.mimeType).toBe("image/png");
    expect(result.upload.filename).toMatch(/\.png$/);
    expect(mockS3Params[0].ContentType).toBe("image/png");
  });

  it.each(["conversation-media", "organizations", "avatars", "document-images"])(
    "refuses SVG in %s",
    async (folder) => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      await expect(
        new StorageService().upload({
          buffer: svg,
          originalName: "logo.svg",
          mimeType: "image/svg+xml",
          folder,
          organizationId: ORG_ID,
        }),
      ).rejects.toThrow();
      expect(mockS3Params).toHaveLength(0);
    },
  );

  it("refuses non-images declared as images in public folders", async () => {
    await expect(
      new StorageService().upload({
        buffer: Buffer.from("<html><script>alert(1)</script></html>"),
        originalName: "image.html",
        mimeType: "image/png",
        folder: "document-images",
        organizationId: ORG_ID,
      }),
    ).rejects.toThrow(/Only JPEG, PNG, GIF or WebP/);
    expect(mockS3Params).toHaveLength(0);
  });

  it("names files after their detected type, never the client file name", async () => {
    const storage = new StorageService();
    const image = await storage.upload({
      buffer: PNG,
      originalName: "image.html",
      mimeType: "image/png",
      folder: "document-images",
      organizationId: ORG_ID,
    });
    expect(image.upload.filename).toMatch(/^[0-9a-f-]+\.png$/);
    expect(mockS3Params[0].ContentType).toBe("image/png");

    const doc = await storage.upload({
      buffer: PNG,
      originalName: "report.html",
      mimeType: "application/pdf",
      folder: `documents/${ORG_ID}`,
      organizationId: ORG_ID,
    });
    expect(doc.upload.mimeType).toBe("image/png");
    expect(doc.upload.filename).toMatch(/\.png$/);

    const text = await storage.upload({
      buffer: Buffer.from("<script>alert(1)</script>"),
      originalName: "notes.html",
      mimeType: "text/plain",
      folder: `documents/${ORG_ID}`,
      organizationId: ORG_ID,
    });
    expect(text.upload.filename).toMatch(/\.txt$/);
  });

  it("refuses private-folder content whose type is not allowed or does not match", async () => {
    const storage = new StorageService();
    await expect(
      storage.upload({
        buffer: Buffer.from("<html><script>alert(1)</script></html>"),
        originalName: "doc.pdf",
        mimeType: "application/pdf",
        folder: `documents/${ORG_ID}`,
        organizationId: ORG_ID,
      }),
    ).rejects.toThrow(/not a supported type/);
    await expect(
      storage.upload({
        buffer: Buffer.from("<html></html>"),
        originalName: "page.html",
        mimeType: "text/html",
        folder: `documents/${ORG_ID}`,
        organizationId: ORG_ID,
      }),
    ).rejects.toThrow();
    expect(mockS3Params).toHaveLength(0);
  });

  it("caps conversation media at its own limit, not the general upload limit (D8-8)", async () => {
    const storage = new StorageService();
    const upload = (bytes: number) =>
      storage.upload({
        buffer: Buffer.alloc(bytes, "a"),
        originalName: "notes.txt",
        mimeType: "text/plain",
        folder: "conversation-media",
        organizationId: ORG_ID,
      });

    await expect(upload(16 * 1024 * 1024)).resolves.toBeDefined();
    await expect(upload(26 * 1024 * 1024)).rejects.toThrow(/File too large/);
  });

  it("keeps organization logos publicly readable with a direct URL", async () => {
    const result = await new StorageService().upload({
      buffer: PNG,
      originalName: "logo.png",
      mimeType: "image/png",
      folder: "organizations",
      organizationId: ORG_ID,
    });

    expect(mockS3Params[0].ACL).toBe("public-read");
    expect(result.url).toMatch(
      new RegExp(
        `^https://ams3\\.digitaloceanspaces\\.com/hay-test/uploads/${ORG_ID}/organizations/`,
      ),
    );
  });

  it("stores plugin ZIPs privately", async () => {
    await new StorageService().uploadPluginZip({
      buffer: Buffer.from("PK\u0003\u0004"),
      originalName: "plugin.zip",
      pluginId: "my-plugin",
      organizationId: ORG_ID,
      uploadedById: "user-1",
    });

    expect(mockS3Params[0].ACL).toBe("private");
  });

  it("deletes an old avatar by its public URL, only for its uploader", async () => {
    const remove = jest.fn(async () => undefined);
    mockFindOne.mockImplementation(async (options) => {
      const where = (options as { where: Record<string, unknown> }).where;
      return where.id ? { id: where.id, storageType: "s3", path: "p", remove } : { id: "old-id" };
    });

    await new StorageService().deleteByPublicUrl(
      `https://ams3.digitaloceanspaces.com/hay-test/uploads/${ORG_ID}/avatars/abc.png?v=1`,
      "avatars",
      "user-1",
    );

    expect(mockFindOne).toHaveBeenCalledWith({
      where: { filename: "abc.png", folder: "avatars", uploadedById: "user-1" },
    });
    expect(remove).toHaveBeenCalled();
  });
});
