/**
 * What happens when a person decides on a held action (D4-5).
 *
 * - Approve: the action runs once (the pending row moves pending -> approved
 *   atomically, so only one caller executes), with the stored idempotency
 *   key, then one AI turn tells the shopper the result.
 * - Reject: one AI turn explains, using the reason.
 * - Reply myself: the action is closed as handled by the team and the
 *   conversation goes to the Needs Attention queue; no AI turn.
 * - No decision before the deadline (D4-8): the action expires (it is never
 *   approved automatically), the shopper is told it was not done and the
 *   conversation goes to the Needs Attention queue.
 *
 * The AI turn is driven by a system note (never shown to the shopper) plus
 * the `approval_decided` orchestrator trigger.
 */
import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType } from "@server/database/entities/message.entity";
import type { PendingAction } from "@server/database/entities/pending-action.entity";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { HANDLED_BY_TEAM_NOTE, pendingActionService, type Decider } from "./pending-action.service";
import { ToolExecutionService } from "./core/tool-execution.service";
import { MessageService } from "./core/message.service";
import { createLogger } from "@server/lib/logger";
import { handoffCopy } from "@server/orchestrator/handoff-copy";
import { getAiReplyBlocker } from "@server/orchestrator/reply-guard";

const logger = createLogger("action-decision");

const CLOSED_STATUSES: ReadonlyArray<Conversation["status"]> = ["resolved", "unresolved", "closed"];

/** The channel's reply window (if it has one) has already closed. */
function replyWindowClosed(conversation: Conversation, now = new Date()): boolean {
  const expiresAt = conversation.reply_window_expires_at;
  return !!expiresAt && new Date(expiresAt).getTime() <= now.getTime();
}

export interface DecisionResult {
  action: PendingAction | null;
  /** False when someone else already decided (double click, two approvers). */
  transitioned: boolean;
  /**
   * Set when the action was not run on purpose: the conversation is closed,
   * so the shopper could not be told the result. It stays pending.
   */
  blocked?: "conversation_closed";
}

export class ActionDecisionService {
  private toolExecution = new ToolExecutionService();
  private messages = new MessageService();

  async approve(id: string, organizationId: string, decider: Decider): Promise<DecisionResult> {
    // Never move money on a closed conversation: the shopper may not be
    // reachable to hear the result. The request stays pending (it can still be
    // declined, or approved once the conversation is reopened).
    const pending = await pendingActionService.findById(id, organizationId);
    if (pending?.status === "pending") {
      const current = await conversationRepository.findById(pending.conversation_id);
      if (current && CLOSED_STATUSES.includes(current.status)) {
        return { action: pending, transitioned: false, blocked: "conversation_closed" };
      }
    }

    const { action, transitioned } = await pendingActionService.approve(
      id,
      organizationId,
      decider,
    );
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
    const outcome = result.success ? "approved and done" : "approved, but it failed";
    await this.resume(conversation, action, note, outcome);
    return { action: final ?? action, transitioned };
  }

  async reject(
    id: string,
    organizationId: string,
    decider: Decider,
    reason: string | null,
  ): Promise<DecisionResult> {
    const decision = await pendingActionService.reject(id, organizationId, decider, reason);
    const { action } = decision;
    if (!action || !decision.transitioned) return decision;

    const conversation = await conversationRepository.findById(action.conversation_id);
    if (!conversation || conversation.organization_id !== organizationId) return decision;

    await this.markToolMessage(action, `Request declined: ${action.tool_name}`, "REJECTED", {
      status: "rejected",
      reason: action.decision_note,
    });
    const why = reason?.trim() ? ` The reason given: "${reason.trim()}".` : " No reason was given.";
    const note =
      `A team member DECLINED the action ${action.tool_name}. It was NOT done.${why} ` +
      `Explain this to the customer kindly, using the reason if there is one, and offer ` +
      `another option if one fits. Do not request it again.`;
    await this.resume(conversation, action, note, "declined");
    return decision;
  }

  /** "I'll reply myself": close the request and put the conversation in the team's queue. */
  async replyMyself(id: string, organizationId: string, decider: Decider): Promise<DecisionResult> {
    const decision = await pendingActionService.reject(
      id,
      organizationId,
      decider,
      HANDLED_BY_TEAM_NOTE,
    );
    const { action } = decision;
    if (!action || !decision.transitioned) return decision;

    await this.markToolMessage(action, `Handed to the team: ${action.tool_name}`, "REJECTED", {
      status: "rejected",
      reason: action.decision_note,
    });
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
    outcome: string,
  ): Promise<void> {
    if (CLOSED_STATUSES.includes(conversation.status)) return;

    await conversation.addMessage({
      content: note,
      type: MessageType.SYSTEM,
      metadata: { pendingActionId: action.id, isApprovalDecision: true },
    });

    if (conversation.status === "awaiting-approval") {
      if (await pendingActionService.hasPending(conversation.id)) return;
    } else if (conversation.status !== "open") {
      return;
    }

    // The channel only accepts replies inside its window (e.g. 24 h after the
    // shopper's last message) and a decision can take up to 48 h. Past it, an
    // AI turn would be refused by the channel, so the team follows up instead.
    if (replyWindowClosed(conversation)) {
      await conversationRepository.update(conversation.id, conversation.organization_id, {
        status: "pending-human",
      });
      await conversation.addMessage({
        content:
          `The team's decision on ${action.tool_name}: ${outcome}. The channel's reply window ` +
          `had already closed, so the AI cannot message the customer about it. The ` +
          `conversation was passed to the team to follow up.`,
        type: MessageType.SYSTEM,
        metadata: { pendingActionId: action.id, isApprovalDecision: true },
      });
      return;
    }

    if (conversation.status === "awaiting-approval") {
      await conversationRepository.update(conversation.id, conversation.organization_id, {
        status: "open",
      });
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

  /**
   * Expire every action past its deadline (scheduled job). Never approves.
   * Returns how many actions expired.
   */
  async expireDue(now: Date = new Date()): Promise<number> {
    const expired = await pendingActionService.expireDue(now);
    const byConversation = new Map<string, PendingAction>();
    for (const action of expired) {
      await this.markToolMessage(action, `Request expired: ${action.tool_name}`, "EXPIRED", {
        status: "expired",
      });
      byConversation.set(action.conversation_id, action);
    }
    for (const action of byConversation.values()) {
      try {
        await this.handOffExpired(action);
      } catch (err) {
        logger.error(
          { err, conversationId: action.conversation_id },
          "Could not hand off after expiry",
        );
      }
    }
    return expired.length;
  }

  /**
   * Once nothing else is waiting, move the conversation to the team's queue and
   * tell the shopper the change was not made. A conversation that already left
   * the awaiting state (closed, taken over) is left alone.
   */
  private async handOffExpired(action: PendingAction): Promise<void> {
    const conversation = await conversationRepository.findById(action.conversation_id);
    if (!conversation || conversation.status !== "awaiting-approval") return;
    if (await pendingActionService.hasPending(conversation.id)) return;

    await conversationRepository.update(conversation.id, conversation.organization_id, {
      status: "pending-human",
    });
    conversation.status = "pending-human";

    await conversation.addMessage({
      content:
        `The approval request for ${action.tool_name} expired without a decision. ` +
        `It was NOT done. The conversation was passed to the team.`,
      type: MessageType.SYSTEM,
      metadata: { pendingActionId: action.id, isApprovalDecision: true },
    });

    // A paused agent stays silent, same as any other hand-off.
    if (getAiReplyBlocker(conversation)) return;
    await conversation.addMessage({
      content: handoffCopy(
        "approvalExpired",
        conversation.language,
        conversation.organization?.defaultLanguage,
      ),
      type: MessageType.BOT_AGENT,
      metadata: {
        pendingActionId: action.id,
        isEscalation: true,
        escalationReason: "approval_expired",
      },
    });
  }

  private async markToolMessage(
    action: PendingAction,
    content: string,
    toolStatus: string,
    toolOutput: Record<string, unknown>,
  ): Promise<void> {
    if (!action.message_id) return;
    const message = await this.messages.messageRepository.findById(action.message_id);
    if (!message) return;
    await this.messages.messageRepository.update(action.message_id, {
      content,
      metadata: { ...message.metadata, toolStatus, toolOutput },
    });
  }
}

export const actionDecisionService = new ActionDecisionService();
