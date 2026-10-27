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
      limits: { maxFileSize: 10 * 1024 * 1024 },
    },
    plugins: { maxUploadSizeMB: 50 },
  },
  getApiUrl: () => "https://api.example.test",
}));

const mockS3Params: Array<Record<string, unknown>> = [];
jest.mock("@aws-sdk/lib-storage", () => ({
  Upload: jest.fn((options: { params: Record<string, unknown> }) => {
    mockS3Params.push(options.params);
    return { done: async () => ({}) };
  }),
}));
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({})),
  DeleteObjectCommand: jest.fn(),
}));

jest.mock("@server/entities/upload.entity", () => ({
  Upload: {
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
});
