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

      // Debugging: Log detailed information about the LLM call
      this.logLLMCallDebugInfo(messages, options);

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

      // Debugging: Log response information
      this.logLLMResponseDebugInfo(response);

      if (!content) {
        throw new Error("No content received from OpenAI");
      }

      if (jsonSchema) {
        console.log("=== JSON SCHEMA RESPONSE PARSING DEBUG ===");
        console.log(`Raw response content (${content.length} chars):`);
        console.log(`"${content}"`);
        console.log(`Content type: ${typeof content}`);
        
        try {
          const parsed = JSON.parse(content);
          console.log(`Successfully parsed JSON. Type: ${typeof parsed}`);
          console.log(`Parsed object keys:`, Object.keys(parsed));
          console.log(`Parsed object:`, JSON.stringify(parsed, null, 2));
          
          // Check for the specific step property that's causing issues
          if (parsed && typeof parsed === 'object') {
            console.log(`parsed.step value: "${parsed.step}" (type: ${typeof parsed.step})`);
            console.log(`parsed.rationale: "${parsed.rationale}"`);
            console.log(`parsed.userMessage: "${parsed.userMessage}"`);
            
            if (parsed.step === undefined) {
              console.error("❌ CRITICAL: step property is undefined after parsing!");
              console.error("This likely indicates a JSON structure mismatch or parsing issue");
            }
          }
          
          console.log("=== END JSON PARSING DEBUG ===");
          return parsed as T;
        } catch (parseError) {
          console.error("❌ JSON PARSING ERROR:");
          console.error(`Parse error: ${parseError}`);
          console.error(`Content that failed to parse: "${content}"`);
          console.error("=== END JSON PARSING DEBUG ===");
          throw parseError;
        }
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

  private logLLMCallDebugInfo(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    options: ChatOptions
  ): void {
    console.log("=== LLM CALL DEBUG INFO ===");
    console.log(`Model: ${options.model || "gpt-4o"}`);
    console.log(`Temperature: ${options.temperature || 0.7}`);
    console.log(`Max tokens: ${options.max_tokens || 2000}`);
    console.log(`Has JSON schema: ${!!options.jsonSchema}`);
    console.log(`Stream: ${!!options.stream}`);
    
    // Message statistics
    console.log(`\n--- MESSAGE STATISTICS ---`);
    console.log(`Total messages: ${messages.length}`);
    
    const roleCount = messages.reduce((acc, msg) => {
      acc[msg.role] = (acc[msg.role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(`Messages by role:`, roleCount);
    
    // Character count analysis
    let totalCharacters = 0;
    const messageLengths: { role: string; length: number; preview: string }[] = [];
    
    messages.forEach((msg, index) => {
      let content = "";
      try {
        if (typeof msg.content === "string") {
          content = msg.content;
        } else if (msg.content) {
          content = JSON.stringify(msg.content);
        }
      } catch (e) {
        content = "[Unable to serialize content]";
      }
      
      const length = content.length;
      totalCharacters += length;
      
      const preview = content.length > 100 ? content.substring(0, 100) + "..." : content;
      messageLengths.push({
        role: msg.role,
        length,
        preview
      });
    });
    
    console.log(`Total characters: ${totalCharacters}`);
    console.log(`Average message length: ${Math.round(totalCharacters / messages.length)}`);
    
    // Token estimation (rough calculation: ~4 characters per token)
    const estimatedTokens = Math.ceil(totalCharacters / 4);
    console.log(`Estimated input tokens: ${estimatedTokens}`);
    
    // Show longest messages
    const longestMessages = messageLengths
      .sort((a, b) => b.length - a.length)
      .slice(0, 3);
    console.log(`\n--- LONGEST MESSAGES ---`);
    longestMessages.forEach((msg, index) => {
      console.log(`${index + 1}. ${msg.role.toUpperCase()}: ${msg.length} chars`);
      console.log(`   Preview: "${msg.preview}"`);
    });
    
    // Show system messages separately (usually contain RAG context)
    const systemMessages = messages.filter(msg => msg.role === "system");
    if (systemMessages.length > 0) {
      console.log(`\n--- SYSTEM MESSAGES ---`);
      systemMessages.forEach((msg, index) => {
        let content = "";
        try {
          if (typeof msg.content === "string") {
            content = msg.content;
          } else if (msg.content) {
            content = JSON.stringify(msg.content);
          }
        } catch (e) {
          content = "[Unable to serialize content]";
        }
        
        console.log(`System ${index + 1}: ${content.length} chars`);
        const preview = content.length > 200 ? content.substring(0, 200) + "..." : content;
        console.log(`   Preview: "${preview}"`);
      });
    }
    
    console.log("=== END LLM CALL DEBUG INFO ===\n");
  }

  private logLLMResponseDebugInfo(response: OpenAI.Chat.Completions.ChatCompletion): void {
    console.log("=== LLM RESPONSE DEBUG INFO ===");
    console.log(`Model: ${response.model}`);
    console.log(`Created: ${new Date(response.created * 1000).toISOString()}`);
    console.log(`Finish reason: ${response.choices[0]?.finish_reason}`);
    
    if (response.usage) {
      console.log(`\n--- TOKEN USAGE ---`);
      console.log(`Prompt tokens: ${response.usage.prompt_tokens}`);
      console.log(`Completion tokens: ${response.usage.completion_tokens}`);
      console.log(`Total tokens: ${response.usage.total_tokens}`);
      
      // Calculate approximate cost (rough estimates for GPT-4o)
      const inputCost = (response.usage.prompt_tokens / 1000) * 0.005; // $5 per 1M tokens
      const outputCost = (response.usage.completion_tokens / 1000) * 0.015; // $15 per 1M tokens
      const totalCost = inputCost + outputCost;
      console.log(`Estimated cost: $${totalCost.toFixed(6)}`);
    }
    
    const responseContent = response.choices[0]?.message?.content || "";
    console.log(`Response length: ${responseContent.length} chars`);
    console.log(`Response preview: "${responseContent.substring(0, 200)}${responseContent.length > 200 ? "..." : ""}"`);
    
    console.log("=== END LLM RESPONSE DEBUG INFO ===\n");
  }
}
