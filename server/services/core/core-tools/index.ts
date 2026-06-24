/**
 * Core tools — always-available, non-plugin-backed tools the planner can
 * call. They live in core (not in a plugin) so that capabilities present in
 * every Hay instance (e.g. recommend_products) don't depend on a specific
 * plugin being installed.
 *
 * Convention: core tool names are UNPREFIXED (no `pluginId:` colon). This
 * is what distinguishes them from plugin/MCP tools in the dispatcher —
 * `ToolExecutionService.executeToolCall` short-circuits when the name is
 * known to this registry.
 */

import type { Conversation } from "@server/database/entities/conversation.entity";
import { createLogger } from "@server/lib/logger";
import { recommendProductsTool } from "./recommend-products";

const logger = createLogger("core-tools");

export interface CoreToolDefinition {
  /** Unprefixed tool name visible to the planner (e.g. "recommend_products"). */
  name: string;
  description: string;
  /** JSON Schema describing the tool's input args. */
  inputSchema: Record<string, unknown>;
  /**
   * Tool body. Receives the conversation (so the impl can scope to the org)
   * plus the parsed args. Whatever it returns is JSON-serialized into the
   * orchestrator's tool-result history just like plugin tool results.
   */
  execute(conversation: Conversation, args: Record<string, unknown>): Promise<unknown>;
}

class CoreToolRegistry {
  private tools = new Map<string, CoreToolDefinition>();

  register(tool: CoreToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Core tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    logger.debug({ toolName: tool.name }, "Registered core tool");
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): CoreToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(
    name: string,
    conversation: Conversation,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Core tool "${name}" not found`);
    return tool.execute(conversation, args);
  }
}

export const coreToolRegistry = new CoreToolRegistry();

// Built-in registrations
coreToolRegistry.register(recommendProductsTool);
