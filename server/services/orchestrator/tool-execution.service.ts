import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { ConversationContext } from "@server/orchestrator/types";
import { MessageService } from "./message.service";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "child_process";
import path from "path";

export class ToolExecutionService {
  private conversationRepository: ConversationRepository;
  private messageService: MessageService;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageService = new MessageService();
  }

  async handleToolExecution(
    conversation: Conversation, 
    toolMessage: Partial<Message>
  ): Promise<void> {
    try {
      const toolCall = (toolMessage.metadata as any)?.tool_call;
      if (!toolCall) {
        console.warn("Tool call message missing tool_call metadata");
        return;
      }

      console.log(`Executing tool: ${toolCall.tool_name} with args:`, toolCall.arguments);
      
      const currentContext = conversation.orchestration_status as ConversationContext | null;
      if (currentContext) {
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
          idempotencyKey: uuidv4()
        };

        const startTime = Date.now();
        try {
          const result = await this.executeToolCall(toolCall);
          
          toolLogEntry.ok = true;
          toolLogEntry.result = result;
          toolLogEntry.latencyMs = Date.now() - startTime;

          await this.messageService.saveToolMessage(
            conversation,
            toolCall,
            result,
            true,
            toolLogEntry.latencyMs
          );
        } catch (error: unknown) {
          const err = error as Error;
          toolLogEntry.ok = false;
          toolLogEntry.errorClass = err.constructor.name;
          toolLogEntry.result = err.message || 'Unknown error';
          toolLogEntry.latencyMs = Date.now() - startTime;

          await this.messageService.saveToolMessage(
            conversation,
            toolCall,
            { error: err.message },
            false,
            toolLogEntry.latencyMs
          );
        }

        currentContext.toolLog.push(toolLogEntry);
        await this.conversationRepository.updateById(conversation.id, {
          orchestration_status: currentContext
        });
      }
    } catch (error) {
      console.error("Error handling tool execution:", error);
    }
  }

  private async executeToolCall(toolCall: any): Promise<any> {
    const { tool_name: toolName, arguments: toolArgs } = toolCall;
    
    console.log(`[ToolExecution] Executing MCP tool: ${toolName}`);
    
    // Find the plugin that contains this tool
    const allPlugins = pluginManagerService.getAllPlugins();
    let matchingPlugin = null;
    let toolSchema = null;
    
    for (const plugin of allPlugins) {
      const manifest = plugin.manifest as any;
      if (manifest.capabilities?.mcp?.tools) {
        const tool = manifest.capabilities.mcp.tools.find((t: any) => t.name === toolName);
        if (tool) {
          matchingPlugin = plugin;
          toolSchema = tool;
          break;
        }
      }
    }
    
    if (!matchingPlugin || !toolSchema) {
      throw new Error(`Tool '${toolName}' not found in any registered plugin`);
    }
    
    console.log(`[ToolExecution] Found tool '${toolName}' in plugin '${matchingPlugin.name}'`);
    
    // Validate tool arguments against input schema
    if (toolSchema.input_schema) {
      const validation = this.validateToolArguments(toolArgs, toolSchema.input_schema);
      if (!validation.valid) {
        throw new Error(`Invalid tool arguments: ${validation.errors.join(', ')}`);
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
    
    // Execute the MCP tool via stdio
    return await this.executeMCPTool(matchingPlugin, startCommand, toolName, toolArgs);
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
          
          if (fieldType === 'string' && typeof fieldValue !== 'string') {
            errors.push(`Field '${fieldName}' must be a string`);
          } else if (fieldType === 'number' && typeof fieldValue !== 'number') {
            errors.push(`Field '${fieldName}' must be a number`);
          } else if (fieldType === 'boolean' && typeof fieldValue !== 'boolean') {
            errors.push(`Field '${fieldName}' must be a boolean`);
          }
          
          // Validate enum values
          const enumValues = (fieldSchema as any).enum;
          if (enumValues && Array.isArray(enumValues)) {
            if (!enumValues.includes(fieldValue)) {
              errors.push(`Field '${fieldName}' must be one of: ${enumValues.join(', ')}`);
            }
          }
        }
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  private async executeMCPTool(plugin: any, startCommand: string, toolName: string, toolArgs: any): Promise<any> {
    return new Promise((resolve, reject) => {
      console.log(`[ToolExecution] Starting MCP server for plugin '${plugin.name}'`);
      
      // Parse the start command
      const [command, ...args] = startCommand.split(' ');
      const pluginPath = path.join(process.cwd(), "..", "plugins", plugin.pluginId.replace("hay-plugin-", ""));
      
      // Spawn the MCP server process
      const mcpProcess = spawn(command, args, {
        cwd: pluginPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      mcpProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      mcpProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      // Send MCP tool call request via stdin
      const mcpRequest = {
        jsonrpc: "2.0",
        id: uuidv4(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: toolArgs
        }
      };
      
      console.log(`[ToolExecution] Sending MCP request:`, JSON.stringify(mcpRequest, null, 2));
      
      mcpProcess.stdin?.write(JSON.stringify(mcpRequest) + '\n');
      mcpProcess.stdin?.end();
      
      mcpProcess.on('close', (code) => {
        console.log(`[ToolExecution] MCP process exited with code ${code}`);
        
        if (code !== 0) {
          console.error(`[ToolExecution] MCP stderr:`, stderr);
          reject(new Error(`MCP tool execution failed with code ${code}: ${stderr}`));
          return;
        }
        
        try {
          // Parse the MCP response from stdout
          const lines = stdout.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          const response = JSON.parse(lastLine);
          
          console.log(`[ToolExecution] MCP response:`, JSON.stringify(response, null, 2));
          
          if (response.error) {
            reject(new Error(`MCP tool error: ${response.error.message || 'Unknown error'}`));
            return;
          }
          
          resolve(response.result || response);
        } catch (parseError) {
          console.error(`[ToolExecution] Failed to parse MCP response:`, stdout);
          reject(new Error(`Failed to parse MCP response: ${parseError}`));
        }
      });
      
      mcpProcess.on('error', (error) => {
        console.error(`[ToolExecution] MCP process error:`, error);
        reject(new Error(`Failed to start MCP process: ${error.message}`));
      });
      
      // Set a timeout for tool execution
      setTimeout(() => {
        if (!mcpProcess.killed) {
          mcpProcess.kill();
          reject(new Error('MCP tool execution timed out after 30 seconds'));
        }
      }, 30000);
    });
  }
}