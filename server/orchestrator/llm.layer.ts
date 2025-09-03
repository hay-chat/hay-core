import { Message, MessageType } from "@server/database/entities/message.entity";
import { config } from "@server/config/env";
import OpenAI from "openai";

export class LLMLayer {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  async generateResponse(
    messages: Message[],
    model: string = "gpt-4o"
  ): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: this.serializeMessages(messages),
        temperature: 0.7,
        max_tokens: 2000,
      });

      return response.choices[0]?.message?.content || "";
    } catch (error) {
      throw new Error(`Failed to generate response: ${error}`);
    }
  }

  async generateEmbedding(
    text: string,
    model: string = "text-embedding-3-small"
  ): Promise<number[]> {
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

  async generateResponseWithContext(
    messages: Message[],
    model: string = "gpt-4o"
  ): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: this.serializeMessages(messages),
        temperature: 0.7,
        max_tokens: 2000,
      });

      return response.choices[0]?.message?.content || "";
    } catch (error) {
      throw new Error(`Failed to generate response with context: ${error}`);
    }
  }

  async generateStructuredResponse<T>(
    prompt: string,
    jsonSchema: object,
    model: string = "gpt-4o"
  ): Promise<T> {
    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "structured_response",
            schema: jsonSchema,
          },
        },
        temperature: 0.7,
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No content received from OpenAI");
      }

      return JSON.parse(content) as T;
    } catch (error) {
      throw new Error(`Failed to generate structured response: ${error}`);
    }
  }

  async generateStructuredResponseWithContext<T>(
    prompt: string,
    context: string,
    jsonSchema: object,
    model: string = "gpt-4o"
  ): Promise<T> {
    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: context },
        { role: "user", content: prompt },
      ];

      const response = await this.openai.chat.completions.create({
        model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "structured_response",
            schema: jsonSchema,
          },
        },
        temperature: 0.7,
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No content received from OpenAI");
      }

      return JSON.parse(content) as T;
    } catch (error) {
      throw new Error(
        `Failed to generate structured response with context: ${error}`
      );
    }
  }

  async generateStreamingResponse(
    prompt: string,
    model: string = "gpt-4o"
  ): Promise<AsyncIterable<string>> {
    try {
      const stream = await this.openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 2000,
        stream: true,
      });

      return this.streamToAsyncIterable(stream);
    } catch (error) {
      throw new Error(`Failed to generate streaming response: ${error}`);
    }
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

  private serializeMessages(messages: Message[]) {
    return messages.map(
      (message) =>
        ({
          role:
            message.type === MessageType.HUMAN_MESSAGE ? "user" : "assistant",
          content: message.content,
        } as OpenAI.Chat.Completions.ChatCompletionMessageParam)
    );
  }
}
