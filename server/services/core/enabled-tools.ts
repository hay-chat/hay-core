/**
 * The playbook's tool list. When the conversation has
 * `enabled_tools` (set by its playbook), only those tools may run; with no
 * list, every tool may. Core tools and page tools are never in a playbook's
 * list and always pass: each one guards itself (create_ticket only works while
 * a hand-off asked for a ticket, complete_product_case checks its evidence),
 * and page tools exist only while the host page is open.
 *
 * Checked in ToolExecutionService.runStep, so every caller is bound by it.
 */

import type { Conversation } from "@server/database/entities/conversation.entity";
import { isPageTool } from "@server/services/webchat/page-tools.service";

export async function isToolEnabled(
  conversation: Pick<Conversation, "enabled_tools">,
  toolName: string,
): Promise<boolean> {
  const enabledTools = conversation.enabled_tools;
  if (!enabledTools || enabledTools.length === 0) return true;
  if (enabledTools.includes(toolName) || isPageTool(toolName)) return true;
  const { coreToolRegistry } = await import("./core-tools");
  return coreToolRegistry.has(toolName);
}
