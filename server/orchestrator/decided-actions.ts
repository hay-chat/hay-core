import { MessageType } from "@server/database/entities/message.entity";
import type { Conversation } from "@server/database/entities/conversation.entity";
import type { ToolLedgerEntry } from "@server/services/core/action-claim-guardrail.service";
import { pendingActionService } from "@server/services/pending-action.service";

/**
 * The decisions this follow-up answers: the approval notes added since the
 * last customer or agent message. They seed the turn's tool ledger so the
 * action-claim guardrail knows what the team approved or declined.
 */
export async function decidedActionsLedger(conversation: Conversation): Promise<ToolLedgerEntry[]> {
  const messages = await conversation.getMessages();
  const ledger: ToolLedgerEntry[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== MessageType.SYSTEM && message.type !== MessageType.TOOL) break;
    const actionId = message.metadata?.isApprovalDecision && message.metadata.pendingActionId;
    if (!actionId) continue;
    const action = await pendingActionService.findById(actionId, conversation.organization_id);
    if (action?.status === "executed" || action?.status === "failed") {
      ledger.unshift({
        name: action.tool_name,
        success: action.status === "executed",
        decision: "approved",
      });
    } else if (action?.status === "rejected") {
      ledger.unshift({ name: action.tool_name, success: false, decision: "declined" });
    }
  }
  return ledger;
}
