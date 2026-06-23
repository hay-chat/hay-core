/**
 * Anthropic (Claude) chat adapter — dedicated, because the Messages API is not
 * OpenAI-shaped: the system prompt is a top-level param (not a message role), roles
 * must alternate, structured output is done via forced tool use, and usage splits
 * cached vs uncached prompt tokens.
 *
 * Structured output uses a single forced tool whose `input_schema` is the JSON
 * Schema; the tool-call input IS the structured object. We advertise
 * strictJsonSchema=false so LLMService still validate-and-repairs as a safety net.
 *
 * @module services/llm/anthropic.provider
 */

import Anthropic from "@anthropic-ai/sdk";
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

function anthropicUsage(usage: Anthropic.Usage | undefined): UsageRecord {
  if (!usage) return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: true };
  // input_tokens is the UNCACHED remainder — sum the cache fields or metering undercounts.
  const promptTokens =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  const completionTokens = usage.output_tokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: false,
  };
}

export const ANTHROPIC_CAPABILITIES: ProviderCapabilities = {
  // Forced tool-use yields schema-shaped JSON, but we keep validate-and-repair on as
  // a backstop rather than claiming a hard guarantee.
  strictJsonSchema: false,
  jsonObjectMode: false,
  toolForcedJson: true,
  streaming: true,
  reportsUsage: true,
  systemRole: "top-level",
  supportedTiers: ["easy", "medium", "hard"],
};

function mapStopReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
    case "tool_use":
      return "stop";
    case "max_tokens":
      return "length";
    case "refusal":
      return "content_filter";
    default:
      return "other";
  }
}

/** Anthropic requires alternating roles; collapse consecutive same-role turns. */
function mergeConsecutive(
  messages: ChatMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      out.push({ role, content: m.content });
    }
  }
  return out;
}

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
  id?: string;
}

export class AnthropicChatProvider implements ChatProvider {
  readonly id: string;
  readonly capabilities = ANTHROPIC_CAPABILITIES;
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions) {
    this.id = opts.id ?? "anthropic";
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  private buildParams(req: ChatRequest): Anthropic.MessageCreateParamsNonStreaming {
    const flags = req.flags ?? {};
    // Reasoning models (Opus) reject sampling params; never send temperature to them.
    const allowsSampling =
      flags.acceptsSampling !== false && !flags.reasoningModel && !/opus/i.test(req.model);

    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = mergeConsecutive(req.messages.filter((m) => m.role !== "system"));

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages,
    };
    if (system) params.system = system;
    if (allowsSampling && req.temperature !== undefined) params.temperature = req.temperature;

    if (req.structured) {
      const name = req.structured.name ?? "structured_response";
      params.tools = [
        {
          name,
          description: "Return the result as the structured object defined by the input schema.",
          input_schema: req.structured.schema as Anthropic.Tool.InputSchema,
        },
      ];
      params.tool_choice = { type: "tool", name };
    }

    return params;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const message = await this.client.messages.create(this.buildParams(req), {
      signal: req.signal,
    });

    let content = "";
    if (req.structured) {
      const toolUse = message.content.find((b) => b.type === "tool_use");
      content = toolUse ? JSON.stringify((toolUse as Anthropic.ToolUseBlock).input) : "";
    } else {
      content = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    }

    return {
      content,
      usage: anthropicUsage(message.usage),
      model: message.model ?? req.model,
      provider: this.id,
      finishReason: mapStopReason(message.stop_reason),
    };
  }

  async chatStream(req: ChatRequest): Promise<ChatStreamResult> {
    const sdkStream = this.client.messages.stream(this.buildParams(req), { signal: req.signal });
    const providerId = this.id;
    const fallbackModel = req.model;

    let resolveCompletion!: (v: StreamCompletionMeta) => void;
    const completion = new Promise<StreamCompletionMeta>((resolve) => {
      resolveCompletion = resolve;
    });

    async function* iterate(): AsyncIterable<string> {
      for await (const event of sdkStream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      const final = await sdkStream.finalMessage();
      resolveCompletion({
        usage: anthropicUsage(final.usage),
        model: final.model ?? fallbackModel,
        provider: providerId,
        finishReason: mapStopReason(final.stop_reason),
      });
    }

    return { stream: iterate(), completion };
  }
}
