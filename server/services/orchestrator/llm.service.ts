import { Message, MessageType } from "@server/database/entities/message.entity";
import { config } from "@server/config/env";
import OpenAI from "openai";

export interface ChatOptions {
  message: string | Message[];
  jsonSchema?: object;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  systemPrompt?: string;
  stream?: boolean;
}

export interface EmbeddingOptions {
  text: string;
  model?: string;
}

export class LLMService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  async chat<T = string>(options: ChatOptions): Promise<T> {
    const {
      message,
      jsonSchema,
      model = "gpt-4o",
      temperature = 0.7,
      max_tokens = 2000,
      systemPrompt,
      stream = false,
    } = options;

    try {
      const messages = this.prepareMessages(message, systemPrompt);

      const requestConfig: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
        {
          model,
          messages,
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

      if (!content) {
        throw new Error("No content received from OpenAI");
      }

      if (jsonSchema) {
        return JSON.parse(content) as T;
      }

      console.log(messages, content);

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
    message: string | Message[],
    systemPrompt?: string
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    if (typeof message === "string") {
      messages.push({ role: "user", content: message });
    } else {
      messages.push(...this.serializeMessages(message));
    }

    return messages;
  }

  private async *streamToAsyncIterable(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  ): AsyncIterable<string> {
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  private serializeMessages(
    messages: Message[]
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
        case MessageType.TOOL_CALL:
        case MessageType.TOOL_RESPONSE:
        default:
          role = "assistant";
          break;
      }

      return {
        role,
        content: message.content,
      };
    });
  }
}
