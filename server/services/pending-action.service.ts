import { v4 as uuidv4 } from "uuid";
import { AppDataSource } from "@server/database/data-source";
import {
  PendingAction,
  type PendingActionHoldReason,
  type PendingActionStatus,
} from "@server/database/entities/pending-action.entity";
import { hookManager } from "@server/services/hooks/hook-manager";
import type { AuthUser } from "@server/lib/auth/AuthUser";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import type { ActionApprovalConfig } from "@server/types/organization-settings.types";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("pending-action");

export type PendingActionEvent =
  | "action_requested"
  | "action_approved"
  | "action_rejected"
  | "action_executed"
  | "action_expired";

export interface HoldInput {
  organizationId: string;
  conversationId: string;
  messageId?: string | null;
  pluginId: string | null;
  toolName: string;
  category: string;
  args: Record<string, unknown>;
  amount: number | null;
  holdReason: PendingActionHoldReason;
  expiryHours: number;
}

/** Result of a decision: the row as it is now, and whether this call moved it. */
export interface Transition {
  action: PendingAction | null;
  transitioned: boolean;
}

/**
 * May this user approve or reject held actions? The owner always can; other
 * roles per the org's `actionApproval.approverRoles` (owner + admin by
 * default); anyone else only with an explicit `actions:approve` permission.
 * API keys need the `actions:approve` scope.
 */
export function canApproveActions(
  user: AuthUser,
  config: Pick<ActionApprovalConfig, "approverRoles">,
): boolean {
  if (user.authMethod === "apikey") {
    return user.hasScope(RESOURCES.ACTIONS, ACTIONS.APPROVE);
  }
  const role = user.getRole();
  if (role === "owner") return true;
  if (role && config.approverRoles.includes(role)) return true;
  return (user.userOrganization?.permissions ?? []).includes(
    `${RESOURCES.ACTIONS}:${ACTIONS.APPROVE}`,
  );
}

/**
 * Who decided. `userId` is stored in `decided_by` (a users FK), so an API key
 * caller has no user id: its key id goes into the decision event instead.
 */
export interface Decider {
  userId: string | null;
  apiKeyId?: string | null;
}

/** The decider of a request: the signed-in user, or the API key that called. */
export function deciderOf(user: AuthUser): Decider {
  if (user.authMethod === "apikey") return { userId: null, apiKeyId: user.apiKeyId ?? null };
  return { userId: user.id };
}

/** The columns a status transition may set alongside the status. */
type DecisionFields = Partial<
  Pick<PendingAction, "decided_by" | "decided_at" | "decision_note" | "error_code" | "executed_at">
>;

export class PendingActionService {
  private get repo() {
    return AppDataSource.getRepository(PendingAction);
  }

  /** Hold a write call. The idempotency key is the one used if it is ever executed. */
  async hold(input: HoldInput): Promise<PendingAction> {
    const action = this.repo.create({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      message_id: input.messageId ?? null,
      plugin_id: input.pluginId,
      tool_name: input.toolName,
      category: input.category,
      args: input.args,
      amount: input.amount,
      hold_reason: input.holdReason,
      status: "pending",
      idempotency_key: uuidv4(),
      expires_at: new Date(Date.now() + input.expiryHours * 3600_000),
    });
    const saved = await this.repo.save(action);
    await this.publish("action_requested", saved);
    return saved;
  }

  async findById(id: string, organizationId: string): Promise<PendingAction | null> {
    return this.repo.findOne({ where: { id, organization_id: organizationId } });
  }

  async listPending(organizationId: string, conversationId?: string): Promise<PendingAction[]> {
    return this.repo.find({
      where: {
        organization_id: organizationId,
        status: "pending",
        ...(conversationId ? { conversation_id: conversationId } : {}),
      },
      order: { created_at: "ASC" },
    });
  }

  async listForConversation(organizationId: string, conversationId: string) {
    return this.repo.find({
      where: { organization_id: organizationId, conversation_id: conversationId },
      order: { created_at: "ASC" },
    });
  }

  /** Is anything still waiting in this conversation? */
  async hasPending(conversationId: string): Promise<boolean> {
    return (
      (await this.repo.count({ where: { conversation_id: conversationId, status: "pending" } })) > 0
    );
  }

  /** Was this exact tool already declined in this conversation? */
  /**
   * The latest request in this conversation for the same tool with the same
   * args that is still waiting or was turned down, if any. Lets the gate
   * answer a repeated call without opening a second request.
   */
  async findEarlierRequest(
    conversationId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PendingAction | null> {
    return this.repo
      .createQueryBuilder("pa")
      .where("pa.conversation_id = :conversationId", { conversationId })
      .andWhere("pa.tool_name = :toolName", { toolName })
      .andWhere("pa.status IN (:...statuses)", { statuses: ["pending", "rejected"] })
      .andWhere("pa.args = CAST(:args AS jsonb)", { args: JSON.stringify(args) })
      .orderBy("pa.created_at", "DESC")
      .getOne();
  }

  /**
   * pending -> approved, once. Expired-but-unswept rows cannot be approved.
   * A second approve (double click, two people) gets `transitioned: false`.
   */
  async approve(id: string, organizationId: string, decider: Decider): Promise<Transition> {
    const moved = await this.transition(
      id,
      organizationId,
      ["pending"],
      "approved",
      {
        decided_by: decider.userId,
        decided_at: new Date(),
      },
      true,
    );
    if (moved) await this.publish("action_approved", moved, { ...decider });
    return { action: moved ?? (await this.findById(id, organizationId)), transitioned: !!moved };
  }

  /** pending -> rejected, once. */
  async reject(
    id: string,
    organizationId: string,
    decider: Decider,
    reason: string | null,
  ): Promise<Transition> {
    const moved = await this.transition(id, organizationId, ["pending"], "rejected", {
      decided_by: decider.userId,
      decided_at: new Date(),
      decision_note: reason,
    });
    if (moved) await this.publish("action_rejected", moved, { ...decider, reason });
    return { action: moved ?? (await this.findById(id, organizationId)), transitioned: !!moved };
  }

  /** approved -> executed. */
  async markExecuted(action: PendingAction): Promise<PendingAction | null> {
    const moved = await this.transition(
      action.id,
      action.organization_id,
      ["approved"],
      "executed",
      {
        executed_at: new Date(),
      },
    );
    if (moved) await this.publish("action_executed", moved);
    return moved;
  }

  /** approved -> failed, with the reason (re-validation or tool error). */
  async markFailed(
    action: PendingAction,
    note: string,
    errorCode: string | null,
  ): Promise<PendingAction | null> {
    return this.transition(action.id, action.organization_id, ["approved"], "failed", {
      decision_note: note,
      error_code: errorCode,
    });
  }

  /** pending -> expired for every row past its deadline. Returns the rows it moved. */
  async expireDue(now: Date = new Date()): Promise<PendingAction[]> {
    const result = await this.repo
      .createQueryBuilder()
      .update(PendingAction)
      .set({ status: "expired" })
      .where("status = 'pending'")
      .andWhere("expires_at <= :now", { now })
      .returning("*")
      .execute();
    const rows = (result.raw ?? []) as PendingAction[];
    for (const row of rows) await this.publish("action_expired", row);
    return rows;
  }

  /**
   * Conditional UPDATE: only moves a row that is still in one of `from`.
   * Returns the updated row, or null if someone else moved it first.
   */
  private async transition(
    id: string,
    organizationId: string,
    from: PendingActionStatus[],
    to: PendingActionStatus,
    fields: DecisionFields,
    requireNotExpired = false,
  ): Promise<PendingAction | null> {
    const qb = this.repo
      .createQueryBuilder()
      .update(PendingAction)
      .set({ ...fields, status: to })
      .where("id = :id", { id })
      .andWhere("organization_id = :organizationId", { organizationId })
      .andWhere("status IN (:...from)", { from });
    if (requireNotExpired) qb.andWhere("expires_at > now()");
    const result = await qb.returning("*").execute();
    const row = (result.raw as PendingAction[] | undefined)?.[0];
    return row ? this.repo.create(row) : null;
  }

  /** Dashboard push (Redis websocket:events) and in-process hooks. Never throws. */
  private async publish(
    event: PendingActionEvent,
    action: PendingAction,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const payload = {
      pendingActionId: action.id,
      conversationId: action.conversation_id,
      toolName: action.tool_name,
      category: action.category,
      status: action.status,
      ...extra,
    };
    try {
      await hookManager.trigger(event, {
        organizationId: action.organization_id,
        conversationId: action.conversation_id,
        metadata: payload,
      });
      const { redisService } = await import("@server/services/redis.service");
      if (redisService.isConnected()) {
        await redisService.publish("websocket:events", {
          type: event,
          organizationId: action.organization_id,
          payload,
        });
      }
    } catch (err) {
      logger.warn({ err, event, pendingActionId: action.id }, "Failed to publish action event");
    }
  }
}

export const pendingActionService = new PendingActionService();
