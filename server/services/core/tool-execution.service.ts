import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { ConversationContext } from "@server/orchestrator/types";
import { MessageService } from "./message.service";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { processManagerService } from "@server/services/process-manager.service";
import { v4 as uuidv4 } from "uuid";

export class ToolExecutionService {
  private conversationRepository: ConversationRepository;
  private messageService: MessageService;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageService = new MessageService();
  }

  async handleToolExecution(
    conversation: Conversation,
    toolMessage: Partial<Message>,
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      const toolCall = toolMessage.metadata?.tool_call;
      if (!toolCall) {
        console.warn("Tool call message missing tool_call metadata");
        return {
          success: false,
          error: "Tool call message missing tool_call metadata",
        };
      }

      console.log(`Executing tool: ${toolCall.tool_name} with args:`, toolCall.arguments);

      const currentContext = conversation.orchestration_status as ConversationContext | null;
      if (currentContext) {
        // Initialize toolLog if it doesn't exist
        if (!currentContext.toolLog) {
          currentContext.toolLog = [];
        }
        const toolLogEntry: {
          turn: number;
          name: string;
          input: any;
          ok: boolean;
          result?: any;
          errorClass?: string;
          latencyMs: number;
          idempotencyKey: string;
        } = {
          turn: currentContext.lastTurn + 1,
          name: toolCall.tool_name,
          input: toolCall.arguments,
          ok: false,
          latencyMs: 0,
          idempotencyKey: uuidv4(),
        };

        const startTime = Date.now();
        try {
          console.log(`[ToolExecutionService] Executing tool call:`, toolCall);
          const result = await this.executeToolCall(conversation, toolCall);
          console.log(`[ToolExecutionService] Tool call result:`, result);

          toolLogEntry.ok = true;
          toolLogEntry.result = result;
          toolLogEntry.latencyMs = Date.now() - startTime;

          await this.messageService.saveToolMessage(
            conversation,
            toolCall,
            result,
            true,
            toolLogEntry.latencyMs,
          );

          currentContext.toolLog.push(toolLogEntry);
          await this.conversationRepository.updateById(conversation.id, {
            orchestration_status: currentContext,
          });

          return { success: true, result };
        } catch (error: unknown) {
          const err = error as Error;
          toolLogEntry.ok = false;
          toolLogEntry.errorClass = err.constructor.name;
          toolLogEntry.result = err.message || "Unknown error";
          toolLogEntry.latencyMs = Date.now() - startTime;

          await this.messageService.saveToolMessage(
            conversation,
            toolCall,
            { error: err.message },
            false,
            toolLogEntry.latencyMs,
          );

          currentContext.toolLog.push(toolLogEntry);
          await this.conversationRepository.updateById(conversation.id, {
            orchestration_status: currentContext,
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

  private async executeToolCall(conversation: Conversation, toolCall: any): Promise<any> {
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
        const manifest = plugin.manifest as any;
        if (manifest.capabilities?.mcp?.tools) {
          console.log(
            `[ToolExecution] Available tools in plugin:`,
            manifest.capabilities.mcp.tools.map((t: any) => t.name),
          );
          const tool = manifest.capabilities.mcp.tools.find((t: any) => t.name === actualToolName);
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
          p.manifest?.capabilities?.mcp?.tools?.map((t: any) => `${p.pluginId}:${t.name}`) || [],
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
      const validation = this.validateToolArguments(toolArgs, toolSchema.input_schema);
      if (!validation.valid) {
        throw new Error(`Invalid tool arguments: ${validation.errors.join(", ")}`);
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

  private validateToolArguments(args: any, schema: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

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
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties as any)) {
        if (fieldName in args) {
          const fieldValue = args[fieldName];
          const fieldType = (fieldSchema as any).type;

          if (fieldType === "string" && typeof fieldValue !== "string") {
            errors.push(`Field '${fieldName}' must be a string`);
          } else if (fieldType === "number" && typeof fieldValue !== "number") {
            errors.push(`Field '${fieldName}' must be a number`);
          } else if (fieldType === "boolean" && typeof fieldValue !== "boolean") {
            errors.push(`Field '${fieldName}' must be a boolean`);
          }

          // Validate enum values
          const enumValues = (fieldSchema as any).enum;
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

  private async executeMCPTool(
    organizationId: string,
    pluginId: string,
    toolName: string,
    toolArgs: any,
  ): Promise<any> {
    console.log(`[ToolExecution] Executing MCP tool: ${pluginId}:${toolName}`);
    console.log(`[ToolExecution] Organization ID: ${organizationId}`);
    console.log(`[ToolExecution] Tool arguments:`, JSON.stringify(toolArgs, null, 2));

    // Check if the plugin process is running
    if (!processManagerService.isRunning(organizationId, pluginId)) {
      console.log(`[ToolExecution] Plugin process not running, attempting to start...`);
      try {
        await processManagerService.startPlugin(organizationId, pluginId);
        console.log(`[ToolExecution] Plugin process started successfully`);
      } catch (error) {
        console.error(`[ToolExecution] Failed to start plugin process:`, error);
        throw new Error(`Plugin process not available: ${(error as Error).message}`);
      }
    }

    // Prepare MCP request
    const mcpRequest = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: toolArgs,
      },
    };

    console.log(
      `[ToolExecution] Sending MCP request to running process:`,
      JSON.stringify(mcpRequest, null, 2),
    );

    try {
      // Use the process manager to send the request to the running MCP process
      const result = await processManagerService.sendToPlugin(
        organizationId,
        pluginId,
        "mcp_call",
        mcpRequest,
      );

      console.log(`[ToolExecution] MCP response received:`, JSON.stringify(result, null, 2));

      if (result.error) {
        throw new Error(`MCP tool error: ${result.error.message || result.error}`);
      }

      return result.result || result;
    } catch (error) {
      console.error(`[ToolExecution] MCP tool execution failed:`, error);
      throw error;
    }
  }
}
