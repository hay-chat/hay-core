import { Message, MessageType } from "@server/database/entities/message.entity";
import { config } from "@server/config/env";
import OpenAI from "openai";
import fs from "fs";
import path from "path";

export interface ChatOptions {
  history?: string | Message[];
  prompt?: string;
  jsonSchema?: object;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface EmbeddingOptions {
  text: string;
  model?: string;
}

export class LLMService {
  private openai: OpenAI;
  private logFilePath: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file path with current date
    const today = new Date().toISOString().split("T")[0];
    this.logFilePath = path.join(logsDir, `llm-${today}.log`);
  }

  async invoke<T = string>(options: ChatOptions): Promise<T> {
    const {
      history,
      prompt,
      jsonSchema,
      model = "gpt-4o",
      temperature = 0.7,
      max_tokens = 2000,
      stream = false,
    } = options;

    try {
      const preparedMessages = this.prepareMessages(history || "", prompt);

      const requestConfig: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: preparedMessages,
        temperature,
        max_tokens,
        ...(jsonSchema && {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "structured_response",
              schema: jsonSchema as Record<string, unknown>,
            },
          },
        }),
      };

      if (stream) {
        const streamResponse = await this.openai.chat.completions.create({
          ...requestConfig,
          stream: true,
        });
        return this.streamToAsyncIterable(streamResponse) as T;
      }

      const response = await this.openai.chat.completions.create(requestConfig);
      const content = response.choices[0]?.message?.content;

      // Debugging: Log response information
      this.logLLMResponseDebugInfo(response);

      if (!content) {
        throw new Error("No content received from OpenAI");
      }
      return content as T;
    } catch (error) {
      throw new Error(`Failed to generate chat response: ${error}`);
    }
  }

  async embedding(options: EmbeddingOptions): Promise<number[]> {
    const { text, model = "text-embedding-3-small" } = options;

    try {
      const response = await this.openai.embeddings.create({
        model,
        input: text,
      });

      return response.data[0]?.embedding || [];
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }

  private prepareMessages(
    history: string | Message[],
    systemPrompt?: string,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

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

  private async *streamToAsyncIterable(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  ): AsyncIterable<string> {
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  private serializeMessages(
    messages: Message[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
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
      console.error(`Failed to write to log file: ${error}`);
    }
  }

  private logLLMResponseDebugInfo(response: OpenAI.Chat.Completions.ChatCompletion): void {
    this.writeToLog("=== LLM RESPONSE DEBUG INFO ===");
    this.writeToLog(`Model: ${response.model}`);
    this.writeToLog(`Created: ${new Date(response.created * 1000).toISOString()}`);
    this.writeToLog(`Finish reason: ${response.choices[0]?.finish_reason}`);

    if (response.usage) {
      this.writeToLog("--- TOKEN USAGE ---");
      this.writeToLog(`Prompt tokens: ${response.usage.prompt_tokens}`);
      this.writeToLog(`Completion tokens: ${response.usage.completion_tokens}`);
      this.writeToLog(`Total tokens: ${response.usage.total_tokens}`);

      // Calculate approximate cost (rough estimates for GPT-4o)
      const inputCost = (response.usage.prompt_tokens / 1000) * 0.005; // $5 per 1M tokens
      const outputCost = (response.usage.completion_tokens / 1000) * 0.015; // $15 per 1M tokens
      const totalCost = inputCost + outputCost;
      this.writeToLog(`Estimated cost: $${totalCost.toFixed(6)}`);
    }

    const responseContent = response.choices[0]?.message?.content || "";
    this.writeToLog(`Response length: ${responseContent.length} chars`);
    this.writeToLog(
      `Response preview: "${responseContent.substring(0, 200)}${
        responseContent.length > 200 ? "..." : ""
      }"`,
    );

    this.writeToLog("=== END LLM RESPONSE DEBUG INFO ===");
  }
}
