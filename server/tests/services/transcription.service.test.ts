import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * transcriptionService — best-effort OpenAI speech-to-text. SDK is mocked.
 */

const mockConfig = {
  openai: { apiKey: "sk-test", models: { transcription: { model: "gpt-4o-mini-transcribe" } } },
};
jest.mock("@server/config/env", () => ({ config: mockConfig }));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// The org's region decides the endpoint; region routing is covered in llm-ai-region.test.ts.
jest.mock("@server/services/llm/llm-provider.factory", () => ({
  llmProviderFactory: {
    managedOpenAIEndpoint: async () => ({ apiKey: mockConfig.openai.apiKey, region: "default" }),
  },
}));
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const mockTranscriptionsCreate =
  jest.fn<(body: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>>();
const mockToFile =
  jest.fn<(value: Buffer, name: string, options: { type: string }) => Promise<unknown>>();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: mockTranscriptionsCreate } },
  })),
  toFile: mockToFile,
}));

import {
  TranscriptionService,
  filenameWithExtension,
} from "@server/services/transcription.service";

const input = {
  buffer: Buffer.from("OggS fake voice"),
  mimeType: "audio/ogg",
  filename: "wamid-123",
  organizationId: "org-1",
};

describe("transcriptionService.transcribe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.openai.apiKey = "sk-test";
    mockToFile.mockImplementation(async (_value, name) => ({ name }));
  });

  it("returns null without calling OpenAI when no API key is configured", async () => {
    mockConfig.openai.apiKey = "";

    await expect(new TranscriptionService().transcribe(input)).resolves.toBeNull();
    expect(mockTranscriptionsCreate).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalled();
  });

  it("returns the trimmed transcript on success", async () => {
    mockTranscriptionsCreate.mockResolvedValue({ text: "  hola, quiero un pedido \n" });

    const text = await new TranscriptionService().transcribe(input);

    expect(text).toBe("hola, quiero un pedido");
    expect(mockToFile).toHaveBeenCalledWith(input.buffer, "wamid-123.ogg", { type: "audio/ogg" });
    expect(mockTranscriptionsCreate).toHaveBeenCalledWith(
      { file: { name: "wamid-123.ogg" }, model: "gpt-4o-mini-transcribe" },
      { timeout: 60_000 },
    );
  });

  it("returns null for an empty transcript", async () => {
    mockTranscriptionsCreate.mockResolvedValue({ text: "   " });

    await expect(new TranscriptionService().transcribe(input)).resolves.toBeNull();
  });

  it("returns null and warn-logs without content when OpenAI fails", async () => {
    mockTranscriptionsCreate.mockRejectedValue(new Error("Unsupported file format"));

    await expect(new TranscriptionService().transcribe(input)).resolves.toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const [fields] = mockLogger.warn.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ organizationId: "org-1", mimeType: "audio/ogg" });
    expect(JSON.stringify(fields)).not.toContain("OggS");
  });
});

describe("filenameWithExtension", () => {
  it.each([
    ["audio/ogg", "voice.ogg"],
    ["audio/mpeg", "voice.mp3"],
    ["audio/mp4", "voice.m4a"],
    ["audio/aac", "voice.aac"],
    ["audio/amr", "voice.amr"],
  ])("derives the extension for %s", (mimeType, expected) => {
    expect(filenameWithExtension("voice", mimeType)).toBe(expected);
  });

  it("keeps an existing extension", () => {
    expect(filenameWithExtension("note.opus", "audio/ogg")).toBe("note.opus");
  });

  it("leaves unknown mime types alone", () => {
    expect(filenameWithExtension("voice", "audio/x-unknown")).toBe("voice");
  });
});
