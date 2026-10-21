import OpenAI, { toFile } from "openai";
import { config } from "../config/env";
import { createLogger } from "@server/lib/logger";

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
// TODO: route through the org's LLM provider bundle and meter usage (HAY-251)
export class TranscriptionService {
  private client: OpenAI | null = null;

  private getClient(): OpenAI | null {
    if (!config.openai.apiKey) {
      return null;
    }
    if (!this.client) {
      this.client = new OpenAI({ apiKey: config.openai.apiKey });
    }
    return this.client;
  }

  async transcribe({
    buffer,
    mimeType,
    filename,
    organizationId,
  }: TranscribeInput): Promise<string | null> {
    const client = this.getClient();
    if (!client) {
      logger.debug({ organizationId }, "Skipping transcription: OPENAI_API_KEY not configured");
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
