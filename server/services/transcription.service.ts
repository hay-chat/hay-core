import OpenAI, { toFile } from "openai";
import { config } from "../config/env";
import { createLogger } from "@server/lib/logger";
import { llmProviderFactory } from "@server/services/llm/llm-provider.factory";

const logger = createLogger("transcription");

const TRANSCRIPTION_TIMEOUT_MS = 60_000;

/** Extensions OpenAI uses to sniff the audio container, keyed by bare mime type. */
const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/amr": ".amr",
};

/**
 * Ensure the filename carries an extension OpenAI can use to detect the format.
 * Channel media often arrives with extension-less names (e.g. a provider media id).
 */
export function filenameWithExtension(filename: string, mimeType: string): string {
  if (/\.[a-z0-9]{2,4}$/i.test(filename)) {
    return filename;
  }
  const extension = AUDIO_EXTENSIONS[mimeType.toLowerCase()];
  return extension ? `${filename}${extension}` : filename;
}

export interface TranscribeInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  organizationId: string;
}

/**
 * Speech-to-text for inbound channel audio (e.g. WhatsApp voice notes).
 *
 * Best effort: every failure path returns null so callers can treat a missing
 * transcript as "no transcript" without failing the surrounding operation.
 */
// TODO: meter usage (HAY-251)
export class TranscriptionService {
  /** One client per endpoint (default or EU), keyed by base URL. */
  private readonly clients = new Map<string, OpenAI>();

  /**
   * The OpenAI client for the org's AI region. EU-only orgs get the EU endpoint or
   * nothing: when EU is not configured, the factory throws and we skip the
   * transcript rather than send the audio to the default endpoint.
   */
  private async getClient(organizationId: string): Promise<OpenAI | null> {
    let endpoint;
    try {
      endpoint = await llmProviderFactory.managedOpenAIEndpoint(organizationId);
    } catch (error) {
      logger.warn(
        { organizationId, error: error instanceof Error ? error.message : String(error) },
        "Skipping transcription: no AI endpoint for this organization's region",
      );
      return null;
    }
    if (!endpoint.apiKey) {
      logger.debug({ organizationId }, "Skipping transcription: OPENAI_API_KEY not configured");
      return null;
    }
    const key = endpoint.baseURL ?? "";
    let client = this.clients.get(key);
    if (!client) {
      client = new OpenAI({ apiKey: endpoint.apiKey, baseURL: endpoint.baseURL });
      this.clients.set(key, client);
    }
    return client;
  }

  async transcribe({
    buffer,
    mimeType,
    filename,
    organizationId,
  }: TranscribeInput): Promise<string | null> {
    const client = await this.getClient(organizationId);
    if (!client) {
      return null;
    }

    const model = config.openai.models.transcription.model;
    try {
      const file = await toFile(buffer, filenameWithExtension(filename, mimeType), {
        type: mimeType,
      });
      const result = await client.audio.transcriptions.create(
        { file, model },
        { timeout: TRANSCRIPTION_TIMEOUT_MS },
      );
      const text = result.text?.trim();
      return text ? text : null;
    } catch (error) {
      // Never log audio bytes or transcript text — only the failure.
      logger.warn(
        {
          organizationId,
          mimeType,
          model,
          size: buffer.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Audio transcription failed",
      );
      return null;
    }
  }
}

export const transcriptionService = new TranscriptionService();
