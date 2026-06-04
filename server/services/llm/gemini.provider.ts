/**
 * Google Gemini chat adapter — dedicated, because the Gemini API differs entirely
 * from OpenAI: system prompt is `systemInstruction`, roles are user/model, the token
 * budget is `maxOutputTokens`, and structured output uses native `responseJsonSchema`.
 *
 * Chat only. Embeddings stay managed (OpenAI @ 1536) for every org per the locked
 * decision, so there is no Gemini EmbeddingProvider here.
 *
 * The adapter always emits native `responseJsonSchema` for structured calls, but
 * advertises strictJsonSchema=false so LLMService still validate-and-repairs — Gemini
 * honors only a subset of JSON Schema, so the backstop matters.
 *
 * @module services/llm/gemini.provider
 */

import { GoogleGenAI } from "@google/genai";
import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResult,
  ChatStreamResult,
  FinishReason,
  ProviderCapabilities,
  StreamCompletionMeta,
  UsageRecord,
} from "./provider.types";

interface GeminiUsageMeta {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

function geminiUsage(meta: GeminiUsageMeta | undefined): UsageRecord {
  if (!meta) return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: true };
  const promptTokens = meta.promptTokenCount ?? 0;
  // thinking models bill thoughts as output tokens.
  const completionTokens = (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: meta.totalTokenCount ?? promptTokens + completionTokens,
    estimated: false,
  };
}

export const GEMINI_CAPABILITIES: ProviderCapabilities = {
  strictJsonSchema: false, // native schema is a subset — keep validate-and-repair on
  jsonObjectMode: true,
  toolForcedJson: true,
  streaming: true,
  reportsUsage: true,
  systemRole: "top-level",
  supportedTiers: ["easy", "medium", "hard"],
};

function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
      return "content_filter";
    default:
      return "other";
  }
}

/** Gemini roles are user/model and consecutive same-role turns should be merged. */
function toContents(
  messages: ChatMessage[],
): Array<{ role: string; parts: Array<{ text: string }> }> {
  const out: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text: m.content });
    } else {
      out.push({ role, parts: [{ text: m.content }] });
    }
  }
  return out;
}

export interface GeminiProviderOptions {
  apiKey: string;
  id?: string;
}

export class GeminiChatProvider implements ChatProvider {
  readonly id: string;
  readonly capabilities = GEMINI_CAPABILITIES;
  private readonly client: GoogleGenAI;

  constructor(opts: GeminiProviderOptions) {
    this.id = opts.id ?? "gemini";
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  /** Build the model/contents/config triple shared by chat() and chatStream(). */
  private buildGenerate(req: ChatRequest): {
    model: string;
    contents: ReturnType<typeof toContents>;
    config: Record<string, unknown>;
  } {
    const flags = req.flags ?? {};
    const allowsSampling = flags.acceptsSampling !== false && !flags.reasoningModel;

    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = toContents(req.messages.filter((m) => m.role !== "system"));

    const config: Record<string, unknown> = { maxOutputTokens: req.maxTokens };
    if (system) config.systemInstruction = system;
    if (allowsSampling && req.temperature !== undefined) config.temperature = req.temperature;
    if (req.structured) {
      config.responseMimeType = "application/json";
      config.responseJsonSchema = req.structured.schema;
    }

    return { model: req.model, contents, config };
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const response = await this.client.models.generateContent(this.buildGenerate(req));

    return {
      content: response.text ?? "",
      usage: geminiUsage(response.usageMetadata),
      model: req.model,
      provider: this.id,
      finishReason: mapFinishReason(response.candidates?.[0]?.finishReason),
    };
  }

  async chatStream(req: ChatRequest): Promise<ChatStreamResult> {
    const sdkStream = await this.client.models.generateContentStream(this.buildGenerate(req));
    const providerId = this.id;
    const model = req.model;

    let resolveCompletion!: (v: StreamCompletionMeta) => void;
    const completion = new Promise<StreamCompletionMeta>((resolve) => {
      resolveCompletion = resolve;
    });

    async function* iterate(): AsyncIterable<string> {
      let last:
        | { usageMetadata?: GeminiUsageMeta; candidates?: Array<{ finishReason?: string }> }
        | undefined;
      for await (const chunk of sdkStream) {
        last = chunk;
        if (chunk.text) yield chunk.text;
      }
      resolveCompletion({
        usage: geminiUsage(last?.usageMetadata),
        model,
        provider: providerId,
        finishReason: mapFinishReason(last?.candidates?.[0]?.finishReason),
      });
    }

    return { stream: iterate(), completion };
  }
}
