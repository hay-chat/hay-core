import type { Conversation } from "@server/database/entities/conversation.entity";
import { isPageTool } from "@server/services/webchat/page-tools.service";
import { publishWidgetEvent } from "@server/services/widget-events.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("tool-activity");

/** What the widget says when the tool's definition names no label. */
export const DEFAULT_TOOL_LABEL = "Working on it…";
export const DEFAULT_TOOL_DONE_LABEL = "Done";

type ActivityConversation = Pick<Conversation, "id" | "organization_id" | "channel">;

/**
 * The progress labels of a tool, from its plugin's tool definition (`label` /
 * `doneLabel`), else the generic ones.
 */
export async function toolLabels(
  organizationId: string,
  fullToolName: string,
): Promise<{ label: string; doneLabel: string }> {
  const fallback = { label: DEFAULT_TOOL_LABEL, doneLabel: DEFAULT_TOOL_DONE_LABEL };
  const colonIndex = fullToolName.lastIndexOf(":");
  if (colonIndex === -1) return fallback;
  const pluginId = fullToolName.substring(0, colonIndex);
  const toolName = fullToolName.substring(colonIndex + 1);
  try {
    const { mcpRegistryService } = await import("@server/services/mcp-registry.service");
    const tool = (await mcpRegistryService.getToolsForOrg(organizationId)).find(
      (t) => t.pluginId === pluginId && t.name === toolName,
    );
    return {
      label: tool?.label ?? fallback.label,
      doneLabel: tool?.doneLabel ?? fallback.doneLabel,
    };
  } catch (error) {
    logger.debug({ err: error, toolName: fullToolName }, "Could not read tool labels");
    return fallback;
  }
}

/**
 * Run a tool while the webchat shows what the AI is doing: an
 * `agent_activity` start before, and an end after (also when it fails). Page
 * tools keep their own on-page overlay, and only web conversations have a
 * widget to tell.
 */
export async function runToolWithActivity<T extends { name: string }, R>(
  conversation: ActivityConversation,
  tool: T,
  run: (tool: T) => Promise<R>,
): Promise<R> {
  if (conversation.channel !== "web" || isPageTool(tool.name)) return run(tool);

  const labels = await toolLabels(conversation.organization_id, tool.name);
  const event = { type: "agent_activity" as const, toolName: tool.name, ...labels };
  await publishWidgetEvent(conversation, { ...event, state: "start" });
  try {
    return await run(tool);
  } finally {
    await publishWidgetEvent(conversation, { ...event, state: "end" });
  }
}
