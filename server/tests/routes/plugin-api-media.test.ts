import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import * as jwt from "jsonwebtoken";

/**
 * pluginApi media.upload — base64 → storage, attachment-shaped result.
 */

const JWT_SECRET = "plugin-api-test-secret";
const mockConfig = {
  jwt: { secret: JWT_SECRET },
  conversation: { cooldownInterval: 1000 },
  storage: {
    s3: {},
    local: { uploadDir: "/tmp/hay-test-uploads", baseUrl: "http://localhost/uploads" },
    limits: { maxFileSize: 10 * 1024 * 1024 },
  },
};
jest.mock("@server/config/env", () => ({ config: mockConfig }));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

jest.mock("@server/trpc", () => jest.requireActual("@server/trpc/init"));
jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

jest.mock("@server/repositories/message.repository", () => ({
  MessageRepository: jest.fn(() => ({})),
  messageRepository: {},
}));
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({})),
  conversationRepository: {},
}));
jest.mock("@server/repositories/customer.repository", () => ({
  CustomerRepository: jest.fn(() => ({})),
}));
jest.mock("@server/repositories/agent.repository", () => ({
  AgentRepository: jest.fn(() => ({})),
  agentRepository: {},
}));
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: {},
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("@server/repositories/document.repository", () => ({ documentRepository: {} }));
jest.mock("@server/services/mcp-registry.service", () => ({ mcpRegistryService: {} }));
jest.mock("@server/services/product-sync.service", () => ({ productSyncService: {} }));
jest.mock("@server/services/redis.service", () => ({
  redisService: { publish: jest.fn(), isConnected: () => true, getClient: () => null },
}));

interface StoredUpload {
  upload: { id: string; mimeType: string; size: number };
  url: string;
}
const mockUpload = jest.fn<(options: Record<string, unknown>) => Promise<StoredUpload>>();
jest.mock("@server/services/storage.service", () => ({
  CONVERSATION_MEDIA_FOLDER: "conversation-media",
  storageService: { upload: mockUpload },
}));

/** Storage echoes the input type and size unless a test says otherwise. */
const storeAs = (url: string) =>
  mockUpload.mockImplementation(async (options) => ({
    upload: {
      id: "upload-1",
      mimeType: options.mimeType as string,
      size: (options.buffer as Buffer).length,
    },
    url,
  }));

const mockTranscribe =
  jest.fn<
    (input: {
      buffer: Buffer;
      mimeType: string;
      filename: string;
      organizationId: string;
    }) => Promise<string | null>
  >();
jest.mock("@server/services/transcription.service", () => ({
  transcriptionService: { transcribe: mockTranscribe },
}));
jest.mock("@server/services/oauth.service", () => ({ oauthService: {} }));

import { pluginApiTrpcRouter } from "@server/routes/v1/plugin-api/trpc";
import type { PluginAuthContext } from "@server/trpc/middleware/plugin-auth";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

const ctx = (capabilities = ["messages"]) => {
  const token = jwt.sign(
    { scope: "plugin-api", organizationId: ORG_ID, pluginId: "hay-channel-test", capabilities },
    JWT_SECRET,
  );
  return {
    user: null,
    organizationId: null,
    req: { headers: { authorization: `Bearer ${token}` } },
    res: {},
  } as unknown as PluginAuthContext;
};

const caller = (capabilities?: string[]) => pluginApiTrpcRouter.createCaller(ctx(capabilities));

describe("pluginApi.media.upload", () => {
  beforeEach(() => jest.clearAllMocks());

  it("decodes base64 and uploads to conversation-media storage", async () => {
    const bytes = Buffer.from("OggS fake audio bytes");
    storeAs("http://localhost/uploads/org/conversation-media/x.ogg");

    const result = await caller()["media.upload"]({
      data: bytes.toString("base64"),
      mimeType: "audio/ogg",
      filename: "voice.ogg",
    });

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const options = mockUpload.mock.calls[0][0] as { buffer: Buffer } & Record<string, unknown>;
    expect(Buffer.isBuffer(options.buffer)).toBe(true);
    expect(options.buffer.equals(bytes)).toBe(true);
    expect(options).toMatchObject({
      originalName: "voice.ogg",
      mimeType: "audio/ogg",
      folder: "conversation-media",
      organizationId: ORG_ID,
    });

    // Matches the Message.attachments element shape exactly.
    expect(result).toEqual({
      id: "upload-1",
      name: "voice.ogg",
      url: "http://localhost/uploads/org/conversation-media/x.ogg",
      type: "audio/ogg",
      size: bytes.length,
    });
  });

  it("reports the stored type and size when storage corrected or re-encoded the file", async () => {
    mockUpload.mockResolvedValue({
      upload: { id: "upload-2", mimeType: "image/png", size: 42 },
      url: "https://api.example/v1/media/upload-2",
    });

    const result = await caller()["media.upload"]({
      data: Buffer.from("not really a jpeg").toString("base64"),
      mimeType: "image/jpeg",
      filename: "photo.jpg",
    });

    expect(result).toMatchObject({ id: "upload-2", type: "image/png", size: 42 });
  });

  it("rejects invalid base64 with BAD_REQUEST", async () => {
    await expect(
      caller()["media.upload"]({
        data: "not*valid*base64!",
        mimeType: "image/png",
        filename: "a.png",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("maps storage validation errors to BAD_REQUEST", async () => {
    mockUpload.mockRejectedValue(new Error("File type not allowed: application/x-msdownload"));

    await expect(
      caller()["media.upload"]({
        data: Buffer.from("MZ").toString("base64"),
        mimeType: "application/x-msdownload",
        filename: "virus.exe",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("not allowed"),
    });
  });

  it("requires the messages capability", async () => {
    await expect(
      caller(["customers"])["media.upload"]({
        data: Buffer.from("x").toString("base64"),
        mimeType: "image/png",
        filename: "a.png",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("pluginApi.media.upload transcription", () => {
  const audio = Buffer.from("OggS fake voice note");
  const upload = (input: { mimeType: string; filename: string; transcribe?: boolean }) =>
    caller()["media.upload"]({ data: audio.toString("base64"), ...input });

  beforeEach(() => {
    jest.clearAllMocks();
    storeAs("http://localhost/u/x");
  });

  it("returns the transcript for audio when transcribe is true", async () => {
    mockTranscribe.mockResolvedValue("hello there");

    const result = await upload({ mimeType: "audio/ogg", filename: "voice", transcribe: true });

    expect(mockTranscribe).toHaveBeenCalledWith({
      buffer: audio,
      mimeType: "audio/ogg",
      filename: "voice",
      organizationId: ORG_ID,
    });
    expect(result).toEqual({
      id: "upload-1",
      name: "voice",
      url: "http://localhost/u/x",
      type: "audio/ogg",
      size: audio.length,
      transcript: "hello there",
    });
  });

  it("does not transcribe non-audio media", async () => {
    const result = await upload({ mimeType: "image/png", filename: "a.png", transcribe: true });

    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("transcript");
  });

  it("omits transcript when STT returns null", async () => {
    mockTranscribe.mockResolvedValue(null);

    const result = await upload({ mimeType: "audio/ogg", filename: "v.ogg", transcribe: true });

    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("transcript");
    expect(result).toMatchObject({ id: "upload-1", type: "audio/ogg" });
  });

  it("does not transcribe when transcribe is omitted", async () => {
    const result = await upload({ mimeType: "audio/ogg", filename: "v.ogg" });

    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("transcript");
  });
});
