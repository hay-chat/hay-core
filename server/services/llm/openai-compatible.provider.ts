/**
 * OpenAI-compatible chat + embedding adapter.
 *
 * Serves OpenAI and every vendor that exposes the OpenAI `/v1/chat/completions`
 * and `/v1/embeddings` surface (Mistral, xAI Grok, custom baseURL deployments) —
 * differentiated purely by `baseURL` + a per-provider `ProviderCapabilities`.
 *
 * This adapter intentionally mirrors the exact request the old inline OpenAI code
 * in llm.service.ts built, so an org on the default bundle sees byte-for-byte
 * identical behavior.
 *
 * @module services/llm/openai-compatible.provider
 */

import OpenAI from "openai";
import { injectSchemaIntoMessages } from "./structured-output";
import type {
  ChatProvider,
  ChatRequest,
  ChatResult,
  ChatStreamResult,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
  FinishReason,
  ProviderCapabilities,
  StreamCompletionMeta,
  UsageRecord,
} from "./provider.types";

/** Capabilities for genuine OpenAI. Other openai-compatible vendors pass their own. */
export const OPENAI_CAPABILITIES: ProviderCapabilities = {
  strictJsonSchema: true,
  jsonObjectMode: true,
  toolForcedJson: true,
  streaming: true,
  reportsUsage: true,
  systemRole: "message",
  supportedTiers: ["easy", "medium", "hard"],
};

/**
 * Capability profiles for OpenAI-compatible vendors, selected by `OrgLlmConfig.chat.vendor`.
 * - openai / grok: strict json_schema is honored (rung 1, trusted).
 * - mistral: accepts the json_schema shape but does NOT hard-guarantee it → strict=false,
 *   so LLMService validate-and-repairs (rung 2 + backstop).
 * - custom: conservative defaults for an unknown vendor (validate everything).
 */
export const OPENAI_COMPATIBLE_CAPABILITIES: Record<string, ProviderCapabilities> = {
  openai: OPENAI_CAPABILITIES,
  grok: OPENAI_CAPABILITIES,
  mistral: {
    strictJsonSchema: false,
    jsonObjectMode: true,
    toolForcedJson: true,
    streaming: true,
    reportsUsage: true,
    systemRole: "message",
    supportedTiers: ["easy", "medium", "hard"],
  },
  custom: {
    strictJsonSchema: false,
    jsonObjectMode: true,
    toolForcedJson: false,
    streaming: true,
    reportsUsage: true,
    systemRole: "message",
    supportedTiers: ["easy", "medium", "hard"],
  },
};

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  /** Defaults to the OpenAI API. Set to a vendor's OpenAI-compatible base URL. */
  baseURL?: string;
  /** Defaults to OpenAI's capabilities; override per vendor (Mistral, Grok, …). */
  capabilities?: ProviderCapabilities;
  /** Fixed embedding dimension this provider is expected to return. */
  embeddingDimensions?: number;
  /** Stable id echoed onto every result. */
  id?: string;
}

function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case null:
    case undefined:
      return "other";
    default:
      return "other";
  }
}

function emptyUsage(estimated: boolean): UsageRecord {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated };
}

export class OpenAICompatibleProvider implements ChatProvider, EmbeddingProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  readonly dimensions: number;
  private readonly client: OpenAI;

  constructor(opts: OpenAICompatibleProviderOptions) {
    this.id = opts.id ?? "openai-compatible";
    this.capabilities = opts.capabilities ?? OPENAI_CAPABILITIES;
    this.dimensions = opts.embeddingDimensions ?? 1536;
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  /**
   * Build the request body. Kept structurally identical to the legacy inline code:
   * temperature + max_tokens by default, response_format json_schema(strict) when a
   * strict structured spec is given, json_object otherwise.
   */
  private buildRequest(
    req: ChatRequest,
  ): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
    const flags = req.flags ?? {};
    const includeTemperature =
      req.temperature !== undefined && flags.acceptsSampling !== false && !flags.reasoningModel;

    const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: req.model,
      messages: req.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    };

    if (flags.usesMaxCompletionTokens) {
      body.max_completion_tokens = req.maxTokens;
    } else {
      body.max_tokens = req.maxTokens;
    }

    if (includeTemperature) {
      body.temperature = req.temperature;
    }

    if (req.structured) {
      const spec = req.structured;
      const name = spec.name ?? "structured_response";
      const wantStrict = spec.strict !== false;

      if (this.capabilities.strictJsonSchema && wantStrict) {
        // Rung 1: provider guarantees schema validity (no post-validation).
        body.response_format = {
          type: "json_schema",
          json_schema: { name, schema: spec.schema, strict: true },
        };
      } else if (this.capabilities.strictJsonSchema) {
        // Strict-capable provider, caller opted into loose JSON — preserve the
        // legacy behavior exactly (json_object, schema lives in the caller's prompt).
        body.response_format = { type: "json_object" };
      } else if (this.capabilities.jsonObjectMode) {
        // Rung 2: provider can't guarantee strict — loose JSON + schema-in-prompt.
        // LLMService validates and repairs the result.
        body.response_format = { type: "json_object" };
        body.messages = injectSchemaIntoMessages(
          req.messages,
          spec.schema,
          name,
        ) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      } else {
        // Rung 4: prompt-only injection (defensive; no OpenAI-compatible vendor lands here).
        body.messages = injectSchemaIntoMessages(
          req.messages,
          spec.schema,
          name,
        ) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      }
    }

    return body;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const response = await this.client.chat.completions.create(this.buildRequest(req), {
      signal: req.signal,
    });

    const choice = response.choices[0];
    const message = choice?.message;
    // A safety refusal arrives as `message.refusal` with null content. Surface it
    // as content_filter so callers don't try to JSON.parse an empty/explanatory body.
    const refused = typeof message?.refusal === "string" && message.refusal.length > 0;
    const content = refused ? "" : (message?.content ?? "");
    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
          estimated: false,
        }
      : emptyUsage(true);

    return {
      content,
      usage,
      model: response.model ?? req.model,
      provider: this.id,
      finishReason: refused ? "content_filter" : mapFinishReason(choice?.finish_reason),
    };
  }

  async chatStream(req: ChatRequest): Promise<ChatStreamResult> {
    const stream = await this.client.chat.completions.create(
      { ...this.buildRequest(req), stream: true, stream_options: { include_usage: true } },
      { signal: req.signal },
    );

    const providerId = this.id;
    let usage: UsageRecord = emptyUsage(true);
    let model = req.model;
    let finishReason: FinishReason = "stop";
    let resolveCompletion!: (v: StreamCompletionMeta) => void;
    const completion = new Promise<StreamCompletionMeta>((resolve) => {
      resolveCompletion = resolve;
    });

    async function* iterate(): AsyncIterable<string> {
      for await (const chunk of stream) {
        if (chunk.model) model = chunk.model;
        const choice = chunk.choices[0];
        if (choice?.finish_reason) finishReason = mapFinishReason(choice.finish_reason);
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
            estimated: false,
          };
        }
        const delta = choice?.delta?.content;
        if (delta) yield delta;
      }
      resolveCompletion({ usage, model, provider: providerId, finishReason });
    }

    return { stream: iterate(), completion };
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResult> {
    const response = await this.client.embeddings.create(
      {
        model: req.model,
        input: req.input,
        ...(req.dimensions ? { dimensions: req.dimensions } : {}),
      },
      { signal: req.signal },
    );

    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    const embeddings = sorted.map((item) => item.embedding);

    return {
      embeddings,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: 0,
        totalTokens: response.usage?.total_tokens ?? 0,
        estimated: !response.usage,
      },
      model: response.model ?? req.model,
      provider: this.id,
      dimensions: embeddings[0]?.length ?? this.dimensions,
    };
  }
}
