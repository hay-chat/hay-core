/**
 * What happens when a person decides on a held action (D4-5).
 *
 * - Approve: the action runs once (the pending row moves pending -> approved
 *   atomically, so only one caller executes), with the stored idempotency
 *   key, then one AI turn tells the shopper the result.
 * - Reject: one AI turn explains, using the reason.
 * - Reply myself: the action is closed as handled by the team and the
 *   conversation goes to the Needs Attention queue; no AI turn.
 *
 * The AI turn is driven by a system note (never shown to the shopper) plus
 * the `approval_decided` orchestrator trigger.
 */
import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType } from "@server/database/entities/message.entity";
import type { PendingAction } from "@server/database/entities/pending-action.entity";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { pendingActionService } from "./pending-action.service";
import { ToolExecutionService } from "./core/tool-execution.service";
import { MessageService } from "./core/message.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("action-decision");

/** Stored on a rejected action closed by "I'll reply myself". */
export const HANDLED_BY_TEAM_NOTE = "handled_by_team";

const CLOSED_STATUSES: ReadonlyArray<Conversation["status"]> = ["resolved", "unresolved", "closed"];

export interface DecisionResult {
  action: PendingAction | null;
  /** False when someone else already decided (double click, two approvers). */
  transitioned: boolean;
}

export class ActionDecisionService {
  private toolExecution = new ToolExecutionService();
  private messages = new MessageService();

  async approve(id: string, organizationId: string, userId: string): Promise<DecisionResult> {
    const { action, transitioned } = await pendingActionService.approve(id, organizationId, userId);
    if (!action || !transitioned) return { action, transitioned };

    const conversation = await conversationRepository.findById(action.conversation_id);
    if (!conversation || conversation.organization_id !== organizationId) {
      const failed = await pendingActionService.markFailed(
        action,
        "The conversation no longer exists",
        "NOT_FOUND",
      );
      return { action: failed ?? action, transitioned };
    }

    const result = await this.toolExecution.executeApprovedAction(conversation, action);
    const final = result.success
      ? await pendingActionService.markExecuted(action)
      : await pendingActionService.markFailed(
          action,
          result.error ?? "The action failed",
          result.errorCode,
        );

    const note = result.success
      ? `A team member APPROVED the action ${action.tool_name} and it has now run successfully ` +
        `(result above). Tell the customer it is done. Do not call this tool again for it.`
      : `A team member approved the action ${action.tool_name}, but it FAILED when it ran: ` +
        `${result.error ?? "unknown error"}. It was NOT done. Tell the customer it did not go ` +
        `through and offer to hand them to the team. Do not retry it.`;
    await this.resume(conversation, action, note);
    return { action: final ?? action, transitioned };
  }

  async reject(
    id: string,
    organizationId: string,
    userId: string,
    reason: string | null,
  ): Promise<DecisionResult> {
    const decision = await pendingActionService.reject(id, organizationId, userId, reason);
    const { action } = decision;
    if (!action || !decision.transitioned) return decision;

    const conversation = await conversationRepository.findById(action.conversation_id);
    if (!conversation || conversation.organization_id !== organizationId) return decision;

    await this.markToolMessage(action, `Request declined: ${action.tool_name}`, "REJECTED");
    const why = reason?.trim() ? ` The reason given: "${reason.trim()}".` : " No reason was given.";
    const note =
      `A team member DECLINED the action ${action.tool_name}. It was NOT done.${why} ` +
      `Explain this to the customer kindly, using the reason if there is one, and offer ` +
      `another option if one fits. Do not request it again.`;
    await this.resume(conversation, action, note);
    return decision;
  }

  /** "I'll reply myself": close the request and put the conversation in the team's queue. */
  async replyMyself(id: string, organizationId: string, userId: string): Promise<DecisionResult> {
    const decision = await pendingActionService.reject(
      id,
      organizationId,
      userId,
      HANDLED_BY_TEAM_NOTE,
    );
    const { action } = decision;
    if (!action || !decision.transitioned) return decision;

    await this.markToolMessage(action, `Handed to the team: ${action.tool_name}`, "REJECTED");
    const conversation = await conversationRepository.findById(action.conversation_id);
    if (conversation && conversation.status === "awaiting-approval") {
      await conversationRepository.update(conversation.id, organizationId, {
        status: "pending-human",
      });
    }
    return decision;
  }

  /**
   * Leave the awaiting state (once nothing else is pending) and queue one AI
   * turn to answer the decision. A conversation a human took over, or one
   * that was closed, gets no AI turn.
   */
  private async resume(
    conversation: Conversation,
    action: PendingAction,
    note: string,
  ): Promise<void> {
    if (CLOSED_STATUSES.includes(conversation.status)) return;

    await conversation.addMessage({
      content: note,
      type: MessageType.SYSTEM,
      metadata: { pendingActionId: action.id, isApprovalDecision: true },
    });

    if (conversation.status === "awaiting-approval") {
      if (await pendingActionService.hasPending(conversation.id)) return;
      await conversationRepository.update(conversation.id, conversation.organization_id, {
        status: "open",
      });
    } else if (conversation.status !== "open") {
      return;
    }

    const { orchestratorQueueService } = await import("./orchestrator-queue.service");
    const queued = await orchestratorQueueService.enqueue(
      conversation.id,
      conversation.organization_id,
      "approval_decided",
    );
    if (!queued) {
      // No queue (RabbitMQ down or not configured): run the turn here, after
      // the response, so the approver is not kept waiting on the LLM.
      const { runApprovalFollowUp } = await import("@server/orchestrator/run");
      setImmediate(() => {
        runApprovalFollowUp(conversation.id).catch((err) =>
          logger.error({ err, conversationId: conversation.id }, "Approval follow-up failed"),
        );
      });
    }
  }

  private async markToolMessage(
    action: PendingAction,
    content: string,
    toolStatus: string,
  ): Promise<void> {
    if (!action.message_id) return;
    const message = await this.messages.messageRepository.findById(action.message_id);
    if (!message) return;
    await this.messages.messageRepository.update(action.message_id, {
      content,
      metadata: {
        ...message.metadata,
        toolStatus,
        toolOutput: { status: "rejected", reason: action.decision_note },
      },
    });
  }
}

export const actionDecisionService = new ActionDecisionService();
