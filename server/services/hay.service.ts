import { ChatOpenAI } from "@langchain/openai";
import { 
  SystemMessage, 
  HumanMessage, 
  AIMessage, 
  ToolMessage, 
  ChatMessage, 
  FunctionMessage,
  BaseMessage
} from "@langchain/core/messages";
import { config } from "../config/env";
import { ConversationService } from "./conversation.service";
import { MessageType } from "../database/entities/message.entity";

export interface HayInputMessage {
  type: MessageType;
  content: string;
  usage_metadata?: Record<string, any>;
}

export interface HayResponse {
  id: string;
  content: string;
  usage_metadata?: Record<string, any>;
  type: MessageType;
  created_at: Date;
}

export class Hay {
  private static model: ChatOpenAI;
  private static conversationService: ConversationService;
  private static initialized = false;

  static init() {
    if (Hay.initialized) return;

    Hay.model = new ChatOpenAI({
      apiKey: config.openai.apiKey,
      modelName: "gpt-4-turbo-preview",
      temperature: 0.7,
      maxTokens: 2000
    });

    Hay.conversationService = new ConversationService();
    Hay.initialized = true;
  }

  static message(input: HayInputMessage): HayInputMessage {
    return {
      type: input.type,
      content: input.content,
      usage_metadata: input.usage_metadata ?? undefined
    };
  }

  static async invoke(
    conversationId: string, 
    inputs: HayInputMessage[]
  ): Promise<HayResponse> {
    if (!Hay.initialized) {
      Hay.init();
    }

    const messages = await Hay.conversationService.addMessages(
      conversationId,
      inputs.map(msg => ({
        content: msg.content,
        type: msg.type,
        usage_metadata: msg.usage_metadata
      }))
    );

    const lcMessages = inputs.map((m) => Hay.toLangChainMessage(m));

    const aiResponse = await Hay.model.invoke(lcMessages);

    const aiContent = typeof aiResponse.content === "string" 
      ? aiResponse.content 
      : JSON.stringify(aiResponse.content);

    const usage = aiResponse.usage_metadata || undefined;

    const aiMessage = await Hay.conversationService.addMessage(conversationId, {
      content: aiContent,
      type: MessageType.AI_MESSAGE,
      usage_metadata: usage
    });

    return {
      id: aiMessage.id,
      content: aiContent,
      usage_metadata: usage,
      type: MessageType.AI_MESSAGE,
      created_at: aiMessage.created_at
    };
  }

  static async invokeWithHistory(
    conversationId: string,
    newMessages: HayInputMessage[]
  ): Promise<HayResponse> {
    if (!Hay.initialized) {
      Hay.init();
    }

    const existingMessages = await Hay.conversationService.getMessages(conversationId);
    
    const existingLcMessages = existingMessages.map(msg => 
      Hay.toLangChainMessage({
        type: msg.type,
        content: msg.content,
        usage_metadata: msg.usage_metadata || undefined
      })
    );

    const newLcMessages = newMessages.map(m => Hay.toLangChainMessage(m));

    const allMessages = [...existingLcMessages, ...newLcMessages];

    await Hay.conversationService.addMessages(
      conversationId,
      newMessages.map(msg => ({
        content: msg.content,
        type: msg.type,
        usage_metadata: msg.usage_metadata
      }))
    );

    const aiResponse = await Hay.model.invoke(allMessages);

    const aiContent = typeof aiResponse.content === "string" 
      ? aiResponse.content 
      : JSON.stringify(aiResponse.content);

    const usage = aiResponse.usage_metadata || undefined;

    const aiMessage = await Hay.conversationService.addMessage(conversationId, {
      content: aiContent,
      type: MessageType.AI_MESSAGE,
      usage_metadata: usage
    });

    return {
      id: aiMessage.id,
      content: aiContent,
      usage_metadata: usage,
      type: MessageType.AI_MESSAGE,
      created_at: aiMessage.created_at
    };
  }

  static async stream(
    conversationId: string,
    inputs: HayInputMessage[]
  ): Promise<AsyncIterable<string>> {
    if (!Hay.initialized) {
      Hay.init();
    }

    await Hay.conversationService.addMessages(
      conversationId,
      inputs.map(msg => ({
        content: msg.content,
        type: msg.type,
        usage_metadata: msg.usage_metadata
      }))
    );

    const lcMessages = inputs.map((m) => Hay.toLangChainMessage(m));

    const stream = await Hay.model.stream(lcMessages);

    let fullContent = "";
    
    const wrappedStream = async function* () {
      for await (const chunk of stream) {
        const chunkContent = typeof chunk.content === "string" 
          ? chunk.content 
          : "";
        fullContent += chunkContent;
        yield chunkContent;
      }

      await Hay.conversationService.addMessage(conversationId, {
        content: fullContent,
        type: MessageType.AI_MESSAGE,
        usage_metadata: undefined
      });
    };

    return wrappedStream();
  }

  private static toLangChainMessage(m: HayInputMessage): BaseMessage {
    switch (m.type) {
      case MessageType.SYSTEM_MESSAGE:
        return new SystemMessage(m.content);
      case MessageType.HUMAN_MESSAGE:
        return new HumanMessage(m.content);
      case MessageType.AI_MESSAGE:
        return new AIMessage(m.content);
      case MessageType.TOOL_MESSAGE:
        return new ToolMessage({ 
          content: m.content, 
          tool_call_id: m.usage_metadata?.tool_call_id || "hay-tool" 
        });
      case MessageType.CHAT_MESSAGE:
        return new ChatMessage({ 
          role: m.usage_metadata?.role || "user", 
          content: m.content 
        });
      case MessageType.FUNCTION_MESSAGE:
        return new FunctionMessage({ 
          name: m.usage_metadata?.name || "hay-fn", 
          content: m.content 
        });
      default:
        return new HumanMessage(m.content);
    }
  }
}

export const hay = Hay;