import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import type { ConversationContext } from "@server/orchestrator/types";
import { MessageService } from "./message.service";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { v4 as uuidv4 } from "uuid";
import type { HayPluginManifest } from "@server/types/plugin.types";
import { conversationSecretService } from "../conversation-secret.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("tool-execution");

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
      logger.info({ toolName: toolCall.name, args: toolCall.args }, "Executing tool");

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
          logger.debug({ toolCall }, "Executing tool call");
          const result = await this.executeToolCall(conversation, {
            tool_name: toolCall.name,
            arguments: toolCall.args,
          });
          logger.debug({ result }, "Tool call result");

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
      logger.error({ err: error }, "Error handling tool execution");
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

    logger.debug({ fullToolName, toolArgs }, "Executing MCP tool");

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

    logger.debug({ pluginId, actualToolName }, "Parsed tool name");

    // Find the plugin that contains this tool
    const allPlugins = pluginManagerService.getAllPlugins();
    logger.debug(
      { availablePlugins: allPlugins.map((p) => ({ id: p.pluginId, name: p.name })) },
      "Available plugins",
    );

    let matchingPlugin = null;
    let toolSchema = null;

    for (const plugin of allPlugins) {
      logger.debug({ pluginId: plugin.pluginId, pluginName: plugin.name }, "Checking plugin");
      if (plugin.pluginId === pluginId) {
        logger.debug({ pluginId }, "Found matching plugin ID");
        const manifest = plugin.manifest as HayPluginManifest;

        // Check if this plugin has dynamic MCP tools (no static tool definitions)
        const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
        const hasMCPCapability = capabilities.includes("mcp");

        if (hasMCPCapability && !manifest.capabilities?.mcp?.tools) {
          // Plugin with dynamic tools - fetched from the running MCP server
          logger.debug("Plugin has dynamic tools, skipping manifest validation");
          matchingPlugin = plugin;
          // No toolSchema needed - the MCP client will handle validation
          break;
        } else if (manifest.capabilities?.mcp?.tools) {
          // Legacy plugin with static tool definitions in manifest
          const mcpTools = manifest.capabilities.mcp.tools;
          logger.debug(
            { tools: mcpTools.map((t) => t.name) },
            "Available tools in plugin",
          );
          const tool = mcpTools.find((t) => t.name === actualToolName);
          if (tool) {
            matchingPlugin = plugin;
            toolSchema = tool;
            logger.debug({ toolName: tool.name }, "Found matching tool");
            break;
          } else {
            logger.debug({ actualToolName }, "Tool not found in this plugin");
          }
        } else {
          logger.debug("Plugin has no MCP capability or tools defined");
        }
      }
    }

    if (!matchingPlugin) {
      const availableTools = allPlugins.flatMap(
        (p) =>
          (p.manifest as HayPluginManifest)?.capabilities?.mcp?.tools?.map(
            (t) => `${p.pluginId}:${t.name}`,
          ) || [],
      );
      throw new Error(
        `Plugin '${pluginId}' not found. Available tools: ${availableTools.join(", ")}`,
      );
    }

    logger.info(
      { toolName: actualToolName, pluginName: matchingPlugin.name },
      "Found tool in plugin",
    );

    // Validate tool arguments against input schema (only for legacy plugins with static schemas)
    if (toolSchema && toolSchema.input_schema) {
      // Ensure input_schema is an object before validation
      if (typeof toolSchema.input_schema === "object") {
        const validation = this.validateToolArguments(
          toolArgs,
          toolSchema.input_schema as ToolSchema["inputSchema"],
        );
        if (!validation.valid) {
          throw new Error(`Invalid tool arguments: ${validation.errors.join(", ")}`);
        }
      }
    } else if (!toolSchema) {
      logger.debug("Skipping argument validation for dynamic plugin (handled by MCP server)");
    }

    // Check if plugin needs installation/building
    if (pluginManagerService.needsInstallation(matchingPlugin.pluginId)) {
      logger.info({ pluginName: matchingPlugin.name }, "Installing plugin");
      await pluginManagerService.installPlugin(matchingPlugin.pluginId);
    }

    if (pluginManagerService.needsBuilding(matchingPlugin.pluginId)) {
      logger.info({ pluginName: matchingPlugin.name }, "Building plugin");
      await pluginManagerService.buildPlugin(matchingPlugin.pluginId);
    }

    // Get the plugin's start command
    const startCommand = pluginManagerService.getStartCommand(matchingPlugin.pluginId);
    if (!startCommand) {
      throw new Error(`Plugin '${matchingPlugin.name}' has no start command defined`);
    }

    logger.debug({ startCommand }, "Plugin start command");

    // Get organization ID from the conversation parameter passed to the parent method
    const organizationId = conversation.organization_id;

    // Inject conversation secrets into tool args before execution
    const enrichedArgs = await this.injectConversationSecrets(
      conversation.id,
      toolArgs,
      toolSchema as Record<string, unknown> | null,
    );

    // Execute the MCP tool via the running process
    return await this.executeMCPTool(
      organizationId,
      matchingPlugin.pluginId,
      actualToolName,
      enrichedArgs,
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
   * Substitute conversation secrets into tool arguments before MCP execution.
   *
   * Two injection modes:
   *  1. `x-hay-secret` annotation on a schema property → inject secret value by key name directly
   *  2. `<<secret.keyname>>` placeholder in any string arg value → replace with real value
   *
   * Secret values never appear in logs or LLM context — only in the actual MCP call.
   */
  private async injectConversationSecrets(
    conversationId: string,
    args: Record<string, unknown>,
    toolSchema: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const secrets = await conversationSecretService.getSecrets(conversationId);
    if (Object.keys(secrets).length === 0) {
      return args;
    }

    const enriched = { ...args };

    // Mode 1: x-hay-secret annotation on schema properties
    const inputSchema = toolSchema?.["input_schema"];
    if (inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)) {
      const properties = (inputSchema as Record<string, unknown>)["properties"];
      if (properties && typeof properties === "object" && !Array.isArray(properties)) {
        for (const [propName, propDef] of Object.entries(properties as Record<string, unknown>)) {
          if (propDef && typeof propDef === "object" && !Array.isArray(propDef)) {
            const secretKey = (propDef as Record<string, unknown>)["x-hay-secret"];
            if (typeof secretKey === "string" && secrets[secretKey] !== undefined) {
              enriched[propName] = secrets[secretKey];
            }
          }
        }
      }
    }

    // Mode 2: <<secret.keyname>> placeholder substitution in string values
    for (const [argKey, argValue] of Object.entries(enriched)) {
      if (typeof argValue === "string") {
        enriched[argKey] = argValue.replace(/<<secret\.([^>]+)>>/g, (_, keyName: string) => {
          return secrets[keyName] ?? `<<secret.${keyName}>>`;
        });
      }
    }

    return enriched;
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
        logger.warn({ messageId }, "Message not found for broadcast");
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
        logger.debug({ messageId }, "Tool result broadcast via Redis");
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
        logger.debug({ messageId }, "Tool result broadcast via WebSocket");
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to broadcast message update");
      // Don't throw - broadcast failure shouldn't break tool execution
    }
  }

  private async executeMCPTool(
    organizationId: string,
    pluginId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<unknown> {
    logger.debug({ pluginId, toolName, organizationId, toolArgs }, "Executing MCP tool via client");

    try {
      // Use MCP client factory to get the appropriate client (local or remote)
      const { MCPClientFactory } = await import("@server/services/mcp-client-factory.service");
      const client = await MCPClientFactory.createClient(organizationId, pluginId);

      // Call the tool
      const result = await client.callTool(toolName, toolArgs);

      logger.debug({ result }, "MCP response received");

      if (result.isError) {
        // Extract error from MCP response — error text may be in content or error field
        const contentText = Array.isArray(result.content)
          ? result.content
              .filter((c: { type: string }) => c.type === "text")
              .map((c: { text?: string }) => c.text || "")
              .join("\n")
          : null;
        const errorDetails = contentText || result.error || "Unknown error";
        const errorMessage =
          typeof errorDetails === "object" ? JSON.stringify(errorDetails) : String(errorDetails);

        const error = new Error(`MCP tool error: ${errorMessage}`);
        // Attach the full error object to the error for better handling
        (error as any).mcpErrorDetails = errorDetails;
        throw error;
      }

      // Return the result content or the full result object
      return result.content || result;
    } catch (error) {
      logger.error({ err: error }, "MCP tool execution failed");
      throw error;
    }
  }
}
