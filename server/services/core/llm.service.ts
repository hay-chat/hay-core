import { Message, MessageType } from "@server/database/entities/message.entity";
import { config } from "@server/config/env";
import fs from "fs";
import path from "path";
import { createLogger } from "@server/lib/logger";
import { llmProviderFactory } from "@server/services/llm/llm-provider.factory";
import { emitUsage } from "@server/services/llm/usage-sink";
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ModelTier,
} from "@server/services/llm/provider.types";

/** Result of a chat call with its normalized usage + provenance, for callers that need it. */
export interface ChatMeta<T> {
  content: T;
  usage: ChatResult["usage"];
  model: string;
  provider: string;
}

const logger = createLogger("llm");

export interface ChatOptions {
  history?: string | Message[];
  prompt?: string;
  jsonSchema?: object;
  strictSchema?: boolean; // Whether to enforce strict schema adherence (default: true for reliability)
  /**
   * Task-complexity tier; resolves to a concrete model via the org's provider config.
   * Primary selector — prefer this over `model`. Defaults to "hard".
   */
  tier?: ModelTier;
  /** Escape hatch: a concrete model id, bypassing tier resolution. */
  model?: string;
  /** Organization whose provider config to use. Falls back to the env default bundle. */
  organizationId?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface EmbeddingOptions {
  text: string;
  model?: string;
}

export class LLMService {
  private logFilePath: string;

  constructor() {
    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file path with current date
    const today = new Date().toISOString().split("T")[0];
    this.logFilePath = path.join(logsDir, `llm-${today}.log`);
  }

  /** Resolve the org's provider bundle and build the provider-neutral request. */
  private resolveChat(options: ChatOptions): {
    bundle: ReturnType<typeof llmProviderFactory.forOrganization>;
    request: ChatRequest;
    organizationId?: string;
    tier: ModelTier;
  } {
    const {
      history,
      prompt,
      jsonSchema,
      strictSchema = true, // Default to strict mode for guaranteed schema compliance
      tier = "hard",
      model,
      organizationId,
      temperature = 0.7,
      max_tokens = 2000,
      signal,
    } = options;

    const bundle = llmProviderFactory.forOrganization(organizationId);
    const resolvedModel = model ?? bundle.tiers[tier];

    const request: ChatRequest = {
      model: resolvedModel,
      messages: this.prepareMessages(history || "", prompt),
      temperature,
      maxTokens: max_tokens,
      signal,
      ...(jsonSchema && {
        structured: {
          schema: jsonSchema as Record<string, unknown>,
          strict: strictSchema,
        },
      }),
    };

    return { bundle, request, organizationId, tier };
  }

  /**
   * Chat completion. Returns the raw string content (callers JSON.parse structured
   * responses). When `stream` is set, returns the async iterable of content chunks.
   */
  async invoke<T = string>(options: ChatOptions): Promise<T> {
    if (options.stream) {
      const { bundle, request, organizationId, tier } = this.resolveChat(options);
      try {
        const streamResponse = await this.executeWithTimeout(
          bundle.chat.chatStream(request),
          60000, // 60 second timeout to establish the stream
        );
        // Meter once the stream is fully consumed.
        streamResponse.completion
          .then((meta) =>
            emitUsage({
              kind: "chat",
              usage: meta.usage,
              model: meta.model,
              provider: meta.provider,
              organizationId,
              tier,
            }),
          )
          .catch(() => undefined);
        return streamResponse.stream as T;
      } catch (error) {
        throw this.wrapError(error, "chat response");
      }
    }

    return (await this.invokeWithMeta<T>(options)).content;
  }

  /**
   * Like `invoke`, but also returns normalized usage + provider/model provenance.
   * Non-streaming only. Every call fires the usage seam.
   */
  async invokeWithMeta<T = string>(options: ChatOptions): Promise<ChatMeta<T>> {
    const { bundle, request, organizationId, tier } = this.resolveChat(options);

    try {
      const result = await this.executeWithTimeout(
        bundle.chat.chat(request),
        30000, // 30 second timeout for non-streaming
      );

      emitUsage({
        kind: "chat",
        usage: result.usage,
        model: result.model,
        provider: result.provider,
        organizationId,
        tier,
      });
      this.logChatResultDebugInfo(result);

      if (!result.content) {
        throw new Error("No content received from LLM provider");
      }
      return {
        content: result.content as T,
        usage: result.usage,
        model: result.model,
        provider: result.provider,
      };
    } catch (error) {
      throw this.wrapError(error, "chat response");
    }
  }

  async embedding(options: EmbeddingOptions): Promise<number[]> {
    const { text, model = config.openai.models.embedding.model } = options;
    const bundle = llmProviderFactory.forOrganization();

    try {
      const result = await this.executeWithTimeout(
        bundle.embedding.embed({ model, input: text }),
        30000, // 30 second timeout for embeddings
      );

      emitUsage({
        kind: "embedding",
        usage: result.usage,
        model: result.model,
        provider: result.provider,
      });

      return result.embeddings[0] ?? [];
    } catch (error) {
      throw this.wrapError(error, "embedding", "LLM embedding timeout");
    }
  }

  private wrapError(error: unknown, what: string, timeoutLabel = "LLM provider timeout"): Error {
    if (error instanceof Error && error.message.includes("timeout")) {
      return new Error(`${timeoutLabel}: ${error.message}`);
    }
    return new Error(`Failed to generate ${what}: ${error}`);
  }

  /**
   * Executes a promise with a timeout
   * @param promise The promise to execute
   * @param timeoutMs Timeout in milliseconds (default: 30000ms / 30s)
   * @returns The promise result
   * @throws Error if the operation times out
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number = 30000): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }

  private prepareMessages(history: string | Message[], systemPrompt?: string): ChatMessage[] {
    const messages: ChatMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    if (typeof history === "string") {
      messages.push({ role: "user", content: history });
    } else {
      messages.push(...this.serializeMessages(history));
    }

    return messages;
  }

  private serializeMessages(messages: Message[]): ChatMessage[] {
    return messages.map((message) => {
      let role: "system" | "user" | "assistant";

      switch (message.type) {
        case MessageType.CUSTOMER:
          role = "user";
          break;
        case MessageType.SYSTEM:
          role = "system";
          break;
        case MessageType.HUMAN_AGENT:
        case MessageType.BOT_AGENT:
        case MessageType.TOOL:
        default:
          role = "assistant";
          break;
      }

      // For TOOL messages, include the actual tool output in the content
      let content = message.content;
      if (message.type === MessageType.TOOL && message.metadata?.toolOutput) {
        const toolOutput = message.metadata.toolOutput;

        // Extract the actual data from MCP format if present
        let formattedOutput = toolOutput;
        if (
          typeof toolOutput === "object" &&
          toolOutput !== null &&
          "content" in toolOutput &&
          Array.isArray(toolOutput.content)
        ) {
          const mcpContent = toolOutput.content as Array<{ text?: string; type?: string }>;
          if (mcpContent.length > 0 && mcpContent[0].text) {
            try {
              formattedOutput = JSON.parse(mcpContent[0].text);
            } catch {
              formattedOutput = mcpContent[0].text;
            }
          }
        }

        content = `Tool: ${message.metadata.toolName || "unknown"}\nStatus: ${message.metadata.toolStatus || "unknown"}\nResult:\n${JSON.stringify(formattedOutput, null, 2)}`;
      }

      return {
        role,
        content,
      };
    });
  }

  private writeToLog(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;

    try {
      fs.appendFileSync(this.logFilePath, logEntry, "utf8");
    } catch (error) {
      logger.error({ err: error }, "Failed to write to log file");
    }
  }

  private logChatResultDebugInfo(result: ChatResult): void {
    this.writeToLog("=== LLM RESPONSE DEBUG INFO ===");
    this.writeToLog(`Provider: ${result.provider}`);
    this.writeToLog(`Model: ${result.model}`);
    this.writeToLog(`Finish reason: ${result.finishReason}`);
    this.writeToLog("--- TOKEN USAGE ---");
    this.writeToLog(`Prompt tokens: ${result.usage.promptTokens}`);
    this.writeToLog(`Completion tokens: ${result.usage.completionTokens}`);
    this.writeToLog(
      `Total tokens: ${result.usage.totalTokens}${result.usage.estimated ? " (estimated)" : ""}`,
    );

    const responseContent = result.content;
    this.writeToLog(`Response length: ${responseContent.length} chars`);
    this.writeToLog(
      `Response preview: "${responseContent.substring(0, 200)}${
        responseContent.length > 200 ? "..." : ""
      }"`,
    );
    this.writeToLog("=== END LLM RESPONSE DEBUG INFO ===");
  }
}
