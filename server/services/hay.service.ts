import { BaseMessage, HumanMessage, AIMessage, SystemMessage, FunctionMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { ConversationService } from "./conversation.service";
import { Message, MessageType } from "../database/entities/message.entity";

export interface HayInputMessage {
  type: MessageType;
  content: string;
  usage_metadata?: Record<string, any>;
}

export interface HayResponse {
  id: string;
  content: string;
  usage_metadata?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  type: MessageType;
  created_at: Date;
}

export class HayService {
  private static model: ChatOpenAI;
  private static conversationService: ConversationService;
  private static initialized = false;

  static init() {
    if (Hay.initialized) {
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    Hay.model = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
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

  // Invoke with conversation management
  static async invokeConversation(
    conversationId: string,
    organizationId: string,
    inputs: HayInputMessage[]
  ): Promise<HayResponse> {
    if (!Hay.initialized) {
      Hay.init();
    }

    // Note: addMessages doesn't have organizationId parameter yet, skip for now
    // const messages = await Hay.conversationService.addMessages(
    //   conversationId,
    //   inputs.map(msg => ({
    //     content: msg.content,
    //     type: msg.type,
    //     usage_metadata: msg.usage_metadata
    //   }))
    // );

    const lcMessages = inputs.map((m) => Hay.toLangChainMessage(m));

    const aiResponse = await Hay.model.invoke(lcMessages);

    const aiContent = typeof aiResponse.content === "string" 
      ? aiResponse.content 
      : JSON.stringify(aiResponse.content);

    const usage = aiResponse.usage_metadata || undefined;

    const aiMessage = await Hay.conversationService.addMessage(conversationId, organizationId, {
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
    organizationId: string,
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

    // Note: addMessages doesn't have organizationId parameter yet, skip for now
    // await Hay.conversationService.addMessages(
    //   conversationId,
    //   newMessages.map(msg => ({
    //     content: msg.content,
    //     type: msg.type,
    //     usage_metadata: msg.usage_metadata
    //   }))
    // );

    const aiResponse = await Hay.model.invoke(allMessages);

    const aiContent = typeof aiResponse.content === "string" 
      ? aiResponse.content 
      : JSON.stringify(aiResponse.content);

    const usage = aiResponse.usage_metadata || undefined;

    const aiMessage = await Hay.conversationService.addMessage(conversationId, organizationId, {
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

  static async invokeWithSystemPrompt(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ content: string; model?: string; usage_metadata?: any }> {
    if (!Hay.initialized) {
      Hay.init();
    }

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt)
    ];

    const aiResponse = await Hay.model.invoke(messages);

    const aiContent = typeof aiResponse.content === "string" 
      ? aiResponse.content 
      : JSON.stringify(aiResponse.content);

    return {
      content: aiContent,
      model: "gpt-4-turbo-preview",
      usage_metadata: aiResponse.usage_metadata || undefined
    };
  }

  static async invoke(prompt: string): Promise<{ content: string; model?: string; usage_metadata?: any }> {
    if (!Hay.initialized) {
      Hay.init();
    }

    const messages = [new HumanMessage(prompt)];
    const aiResponse = await Hay.model.invoke(messages);

    const aiContent = typeof aiResponse.content === "string" 
      ? aiResponse.content 
      : JSON.stringify(aiResponse.content);

    return {
      content: aiContent,
      model: "gpt-4-turbo-preview",
      usage_metadata: aiResponse.usage_metadata || undefined
    };
  }

  static async function(
    conversationId: string,
    organizationId: string,
    name: string,
    args: Record<string, any>
  ): Promise<any> {
    if (!Hay.initialized) {
      Hay.init();
    }

    const toolOutput = await Hay.executeTool(name, args);

    if (toolOutput) {
      await Hay.conversationService.addMessage(conversationId, organizationId, {
        content: toolOutput,
        type: MessageType.TOOL_MESSAGE,
        usage_metadata: { tool_name: name }
      });
    }

    return toolOutput;
  }

  private static async executeTool(name: string, args: Record<string, any>): Promise<string> {
    // Tool execution logic here
    // This is a placeholder implementation
    return `Executed tool: ${name} with args: ${JSON.stringify(args)}`;
  }

  private static toLangChainMessage(message: HayInputMessage): BaseMessage {
    switch(message.type) {
      case MessageType.HUMAN_MESSAGE:
        return new HumanMessage(message.content);
      case MessageType.AI_MESSAGE:
        return new AIMessage(message.content);
      case MessageType.SYSTEM_MESSAGE:
        return new SystemMessage(message.content);
      case MessageType.FUNCTION_MESSAGE:
        return new FunctionMessage({
          content: message.content,
          name: message.usage_metadata?.function_name || "function"
        });
      case MessageType.TOOL_MESSAGE:
        return new ToolMessage({
          content: message.content,
          tool_call_id: message.usage_metadata?.tool_call_id || "tool"
        });
      case MessageType.CHAT_MESSAGE:
      default:
        return new HumanMessage(message.content);
    }
  }
}

// Export singleton instance
export const Hay = HayService;