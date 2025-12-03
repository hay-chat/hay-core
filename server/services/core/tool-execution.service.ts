import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import type { ConversationContext } from "@server/orchestrator/types";
import { MessageService } from "./message.service";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { processManagerService } from "@server/services/process-manager.service";
import { v4 as uuidv4 } from "uuid";
import type { HayPluginManifest } from "@server/types/plugin.types";

interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

interface ToolCallData {
  tool_name: string;
  arguments: Record<string, unknown>;
}

interface ToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: unknown[];
        required?: boolean;
      }
    >;
    required?: string[];
  };
}

export class ToolExecutionService {
  private conversationRepository: ConversationRepository;
  private messageService: MessageService;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageService = new MessageService();
  }

  async handleToolExecution(
    conversation: Conversation,
    toolCall: { name: string; args: Record<string, unknown> },
    messageId?: string,
  ): Promise<ToolExecutionResult> {
    try {
      console.log(`Executing tool: ${toolCall.name} with args:`, toolCall.args);

      const currentContext = conversation.orchestration_status as ConversationContext | null;
      if (currentContext) {
        // Initialize toolLog if it doesn't exist
        if (!currentContext.toolLog) {
          currentContext.toolLog = [];
        }
        const toolLogEntry: {
          turn: number;
          name: string;
          input: Record<string, unknown>;
          ok: boolean;
          result?: unknown;
          errorClass?: string;
          latencyMs: number;
          idempotencyKey: string;
        } = {
          turn: currentContext.lastTurn + 1,
          name: toolCall.name,
          input: toolCall.args,
          ok: false,
          latencyMs: 0,
          idempotencyKey: uuidv4(),
        };

        const startTime = Date.now();
        const executedAt = new Date().toISOString();

        try {
          console.log(`[ToolExecutionService] Executing tool call:`, toolCall);
          const result = await this.executeToolCall(conversation, {
            tool_name: toolCall.name,
            arguments: toolCall.args,
          });
          console.log(`[ToolExecutionService] Tool call result:`, result);

          toolLogEntry.ok = true;
          toolLogEntry.result = result;
          toolLogEntry.latencyMs = Date.now() - startTime;

          // Update the message with the result
          if (messageId) {
            const message = await this.messageService.messageRepository.findById(messageId);
            if (message) {
              await this.messageService.messageRepository.update(messageId, {
                content: `Action completed: ${toolCall.name}`,
                metadata: {
                  ...message.metadata,
                  toolOutput: result,
                  toolStatus: "SUCCESS",
                  toolLatencyMs: toolLogEntry.latencyMs,
                  toolExecutedAt: executedAt,
                  httpStatus: 200,
                },
              });

              // Broadcast the updated message via WebSocket
              await this.broadcastMessageUpdate(conversation, message.id, {
                content: `Action completed: ${toolCall.name}`,
                metadata: {
                  ...message.metadata,
                  toolOutput: result,
                  toolStatus: "SUCCESS",
                  toolLatencyMs: toolLogEntry.latencyMs,
                  toolExecutedAt: executedAt,
                  httpStatus: 200,
                },
              });
            }
          }

          currentContext.toolLog.push(toolLogEntry);
          await this.conversationRepository.updateById(conversation.id, {
            orchestration_status: currentContext as any,
          });

          return { success: true, result };
        } catch (error: unknown) {
          const err = error as Error;
          toolLogEntry.ok = false;
          toolLogEntry.errorClass = err.constructor.name;
          toolLogEntry.result = err.message || "Unknown error";
          toolLogEntry.latencyMs = Date.now() - startTime;

          // Extract MCP error details if available
          const mcpErrorDetails = (err as any).mcpErrorDetails;
          const errorOutput = mcpErrorDetails || {
            error: err.message || "Unknown error",
            errorType: err.constructor.name,
            stack: err.stack,
          };

          // Update the message with the error
          if (messageId) {
            const message = await this.messageService.messageRepository.findById(messageId);
            if (message) {
              await this.messageService.messageRepository.update(messageId, {
                content: `Action failed: ${toolCall.name}`,
                metadata: {
                  ...message.metadata,
                  toolOutput: errorOutput,
                  toolStatus: "ERROR",
                  toolLatencyMs: toolLogEntry.latencyMs,
                  toolExecutedAt: executedAt,
                  httpStatus: 500,
                },
              });

              // Broadcast the updated message via WebSocket
              await this.broadcastMessageUpdate(conversation, message.id, {
                content: `Action failed: ${toolCall.name}`,
                metadata: {
                  ...message.metadata,
                  toolOutput: errorOutput,
                  toolStatus: "ERROR",
                  toolLatencyMs: toolLogEntry.latencyMs,
                  toolExecutedAt: executedAt,
                  httpStatus: 500,
                },
              });
            }
          }

          currentContext.toolLog.push(toolLogEntry);
          await this.conversationRepository.updateById(conversation.id, {
            orchestration_status: currentContext as any,
          });

          return { success: false, error: err.message || "Unknown error" };
        }
      }

      return { success: false, error: "No conversation context available" };
    } catch (error) {
      console.error("Error handling tool execution:", error);
      return {
        success: false,
        error: (error as Error).message || "Unknown error",
      };
    }
  }

  private async executeToolCall(
    conversation: Conversation,
    toolCall: ToolCallData,
  ): Promise<unknown> {
    const { tool_name: fullToolName, arguments: toolArgs } = toolCall;

    console.log(`[ToolExecution] Executing MCP tool: ${fullToolName}`);
    console.log(`[ToolExecution] Tool arguments:`, JSON.stringify(toolArgs, null, 2));

    // Parse the tool name to extract plugin and tool parts
    // Expected format: "{pluginId}:{toolName}"
    const colonIndex = fullToolName.lastIndexOf(":");
    if (colonIndex === -1) {
      throw new Error(
        `Invalid tool name format: ${fullToolName}. Expected format: {pluginId}:{toolName}`,
      );
    }

    const pluginId = fullToolName.substring(0, colonIndex);
    const actualToolName = fullToolName.substring(colonIndex + 1);

    console.log(`[ToolExecution] Parsed plugin ID: ${pluginId}, tool name: ${actualToolName}`);

    // Find the plugin that contains this tool
    const allPlugins = pluginManagerService.getAllPlugins();
    console.log(
      `[ToolExecution] Available plugins:`,
      allPlugins.map((p) => ({ id: p.pluginId, name: p.name })),
    );

    let matchingPlugin = null;
    let toolSchema = null;

    for (const plugin of allPlugins) {
      console.log(`[ToolExecution] Checking plugin: ${plugin.pluginId} (${plugin.name})`);
      if (plugin.pluginId === pluginId) {
        console.log(`[ToolExecution] Found matching plugin ID: ${pluginId}`);
        const manifest = plugin.manifest as HayPluginManifest;
        if (manifest.capabilities?.mcp?.tools) {
          console.log(
            `[ToolExecution] Available tools in plugin:`,
            manifest.capabilities.mcp.tools.map((t) => t.name),
          );
          const tool = manifest.capabilities.mcp.tools.find((t) => t.name === actualToolName);
          if (tool) {
            matchingPlugin = plugin;
            toolSchema = tool;
            console.log(`[ToolExecution] Found matching tool:`, tool.name);
            break;
          } else {
            console.log(`[ToolExecution] Tool '${actualToolName}' not found in this plugin`);
          }
        } else {
          console.log(`[ToolExecution] Plugin has no MCP tools defined`);
        }
      }
    }

    if (!matchingPlugin || !toolSchema) {
      const availableTools = allPlugins.flatMap(
        (p) =>
          (p.manifest as HayPluginManifest)?.capabilities?.mcp?.tools?.map(
            (t) => `${p.pluginId}:${t.name}`,
          ) || [],
      );
      throw new Error(
        `Tool '${actualToolName}' not found in plugin '${pluginId}'. Available tools: ${availableTools.join(
          ", ",
        )}`,
      );
    }

    console.log(
      `[ToolExecution] Found tool '${actualToolName}' in plugin '${matchingPlugin.name}'`,
    );

    // Validate tool arguments against input schema
    if (toolSchema.input_schema) {
      // Ensure input_schema is an object before validation
      if (typeof toolSchema.input_schema === 'object') {
        const validation = this.validateToolArguments(toolArgs, toolSchema.input_schema as ToolSchema["inputSchema"]);
        if (!validation.valid) {
          throw new Error(`Invalid tool arguments: ${validation.errors.join(", ")}`);
        }
      }
    }

    // Check if plugin needs installation/building
    if (pluginManagerService.needsInstallation(matchingPlugin.pluginId)) {
      console.log(`[ToolExecution] Installing plugin '${matchingPlugin.name}'`);
      await pluginManagerService.installPlugin(matchingPlugin.pluginId);
    }

    if (pluginManagerService.needsBuilding(matchingPlugin.pluginId)) {
      console.log(`[ToolExecution] Building plugin '${matchingPlugin.name}'`);
      await pluginManagerService.buildPlugin(matchingPlugin.pluginId);
    }

    // Get the plugin's start command
    const startCommand = pluginManagerService.getStartCommand(matchingPlugin.pluginId);
    if (!startCommand) {
      throw new Error(`Plugin '${matchingPlugin.name}' has no start command defined`);
    }

    console.log(`[ToolExecution] Plugin start command: ${startCommand}`);

    // Get organization ID from the conversation parameter passed to the parent method
    const organizationId = conversation.organization_id;

    // Execute the MCP tool via the running process
    return await this.executeMCPTool(
      organizationId,
      matchingPlugin.pluginId,
      actualToolName,
      toolArgs,
    );
  }

  private validateToolArguments(
    args: Record<string, unknown>,
    schema: ToolSchema["inputSchema"],
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!schema) {
      return { valid: true, errors: [] };
    }

    // Basic validation - check required properties
    if (schema.required && Array.isArray(schema.required)) {
      for (const requiredField of schema.required) {
        if (!(requiredField in args)) {
          errors.push(`Missing required field: ${requiredField}`);
        }
      }
    }

    // Type validation for properties
    if (schema.properties) {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        if (fieldName in args) {
          const fieldValue = args[fieldName];
          const fieldType = fieldSchema.type;

          if (fieldType === "string" && typeof fieldValue !== "string") {
            errors.push(`Field '${fieldName}' must be a string`);
          } else if (fieldType === "number" && typeof fieldValue !== "number") {
            errors.push(`Field '${fieldName}' must be a number`);
          } else if (fieldType === "boolean" && typeof fieldValue !== "boolean") {
            errors.push(`Field '${fieldName}' must be a boolean`);
          }

          // Validate enum values
          const enumValues = fieldSchema.enum;
          if (enumValues && Array.isArray(enumValues)) {
            if (!enumValues.includes(fieldValue)) {
              errors.push(`Field '${fieldName}' must be one of: ${enumValues.join(", ")}`);
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Broadcast a message update via WebSocket/Redis
   * This ensures the frontend receives real-time updates when tool calls complete
   */
  private async broadcastMessageUpdate(
    conversation: Conversation,
    messageId: string,
    updates: { content: string; metadata: Record<string, unknown> },
  ): Promise<void> {
    try {
      const { redisService } = await import("@server/services/redis.service");

      // Fetch the full message to get all fields
      const message = await this.messageService.messageRepository.findById(messageId);
      if (!message) {
        console.warn(`[ToolExecution] Message ${messageId} not found for broadcast`);
        return;
      }

      const eventPayload = {
        type: "message_received",
        organizationId: conversation.organization_id,
        conversationId: conversation.id,
        payload: {
          id: message.id,
          content: updates.content,
          type: message.type,
          sender: message.sender,
          timestamp: message.created_at,
          metadata: updates.metadata,
          status: message.status,
          deliveryState: message.deliveryState,
        },
      };

      if (redisService.isConnected()) {
        // Publish to Redis for distribution across all server instances
        await redisService.publish("websocket:events", eventPayload);
        console.log(`[ToolExecution] Tool result broadcast via Redis for message ${messageId}`);
      } else {
        // Fallback to direct WebSocket if Redis not available
        const { websocketService } = await import("@server/services/websocket.service");

        const messagePayload = {
          type: "message",
          data: {
            id: message.id,
            content: updates.content,
            type: message.type,
            sender: message.sender,
            timestamp: message.created_at,
            metadata: updates.metadata,
          },
        };

        // Broadcast to both organization (dashboard) and conversation (webchat) clients
        websocketService.sendToOrganization(conversation.organization_id, messagePayload);
        websocketService.sendToConversation(conversation.id, messagePayload);
        console.log(`[ToolExecution] Tool result broadcast via WebSocket for message ${messageId}`);
      }
    } catch (error) {
      console.error(`[ToolExecution] Failed to broadcast message update:`, error);
      // Don't throw - broadcast failure shouldn't break tool execution
    }
  }

  private async executeMCPTool(
    organizationId: string,
    pluginId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<unknown> {
    console.log(`[ToolExecution] Executing MCP tool: ${pluginId}:${toolName}`);
    console.log(`[ToolExecution] Organization ID: ${organizationId}`);
    console.log(`[ToolExecution] Tool arguments:`, JSON.stringify(toolArgs, null, 2));

    try {
      // Use MCP client factory to get the appropriate client (local or remote)
      const { MCPClientFactory } = await import("@server/services/mcp-client-factory.service");
      const client = await MCPClientFactory.createClient(organizationId, pluginId);

      // Call the tool
      const result = await client.callTool(toolName, toolArgs);

      console.log(`[ToolExecution] MCP response received:`, JSON.stringify(result, null, 2));

      if (result.isError) {
        // Preserve the full error object for better error visibility
        const errorDetails = result.error || { message: "Unknown error" };
        const errorMessage = typeof errorDetails === "object"
          ? JSON.stringify(errorDetails)
          : String(errorDetails);

        const error = new Error(`MCP tool error: ${errorMessage}`);
        // Attach the full error object to the error for better handling
        (error as any).mcpErrorDetails = errorDetails;
        throw error;
      }

      // Return the result content or the full result object
      return result.content || result;
    } catch (error) {
      console.error(`[ToolExecution] MCP tool execution failed:`, error);
      throw error;
    }
  }
}
