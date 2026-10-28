import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { t, authenticatedProcedure, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import type { AuthUser } from "@server/lib/auth/AuthUser";
import { organizationRepository } from "@server/repositories/organization.repository";
import { resolveActionApprovalConfig } from "@server/types/organization-settings.types";
import { categoryNeedsApproval } from "@server/services/core/action-policy";
import {
  canApproveActions,
  deciderOf,
  pendingActionService,
} from "@server/services/pending-action.service";
import {
  actionDecisionService,
  type DecisionResult,
} from "@server/services/action-decision.service";

/**
 * AI write actions waiting for a person (D4-3 / D4-5): list, approve, reject,
 * or "I'll reply myself". Approvers are the owner, the roles in the org's
 * `actionApproval.approverRoles` (owner and admin by default), members given
 * the `actions:approve` permission, and API keys with that scope.
 */
async function assertApprover(
  user: AuthUser | null | undefined,
  organizationId: string | null | undefined,
) {
  if (!user || !organizationId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Organization context required" });
  }
  const organization = await organizationRepository.findById(organizationId);
  if (!canApproveActions(user, resolveActionApprovalConfig(organization?.settings))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to approve actions",
    });
  }
  return organizationId;
}

function toResponse({ action, transitioned, blocked }: DecisionResult) {
  if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "Action not found" });
  if (blocked === "invalid_amount") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The amount can only be lowered, must be above zero, and only on a request with a single amount.",
    });
  }
  if (blocked === "conversation_closed") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This conversation is closed, so the action was not run. Reopen the conversation to approve it, or decline it.",
    });
  }
  return { action, transitioned };
}

const idInput = z.object({ id: z.string().uuid() });

export const actionsRouter = t.router({
  listPending: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(z.object({ conversationId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      pendingActionService.listPending(ctx.organizationId!, input?.conversationId),
    ),

  listForConversation: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      pendingActionService.listForConversation(ctx.organizationId!, input.conversationId),
    ),

  /** Whether the current user may decide; lets the dashboard hide the buttons. */
  canApprove: authenticatedProcedure.query(async ({ ctx }) => {
    try {
      await assertApprover(ctx.user, ctx.organizationId);
      return { canApprove: true };
    } catch {
      return { canApprove: false };
    }
  }),

  /** Pending actions across all conversations, for the Approvals list (D4-6). */
  listApprovals: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ).query(({ ctx }) =>
    pendingActionService.listApprovals(ctx.organizationId!),
  ),

  /**
   * The graduation nudge (D4-11): "you approved N of N refunds up to X; auto-
   * approve below that?". Null unless approval is on for that category and
   * every recent decision was an approval. Applying it is a settings change,
   * which only the owner may make (it loosens approval).
   */
  graduationSuggestion: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = await assertApprover(ctx.user, ctx.organizationId);
    const organization = await organizationRepository.findById(organizationId);
    const config = resolveActionApprovalConfig(organization?.settings);
    if (!config.moneyMovesNeedApproval) return null;
    const suggestion = await pendingActionService.graduationSuggestion(
      organizationId,
      config.thresholdAmount,
    );
    if (!suggestion || !categoryNeedsApproval(config, suggestion.category)) return null;
    return suggestion;
  }),

  /** `amount` lowers the amount before it runs: never up (checked in the service). */
  approve: authenticatedProcedure
    .input(idInput.extend({ amount: z.number().positive().finite().optional() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await assertApprover(ctx.user, ctx.organizationId);
      return toResponse(
        await actionDecisionService.approve(
          input.id,
          organizationId,
          deciderOf(ctx.user!),
          input.amount,
        ),
      );
    }),

  /** Approve several pending actions of the same kind (D4-6). */
  approveMany: authenticatedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await assertApprover(ctx.user, ctx.organizationId);
      const ids = [...new Set(input.ids)];
      const actions = await Promise.all(
        ids.map((id) => pendingActionService.findById(id, organizationId)),
      );
      const categories = new Set(actions.map((action) => action?.category));
      if (actions.some((action) => !action) || categories.size !== 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bulk approval needs existing requests of the same kind.",
        });
      }
      return {
        results: await actionDecisionService.approveMany(ids, organizationId, deciderOf(ctx.user!)),
      };
    }),

  reject: authenticatedProcedure
    .input(idInput.extend({ reason: z.string().trim().max(1000).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await assertApprover(ctx.user, ctx.organizationId);
      return toResponse(
        await actionDecisionService.reject(
          input.id,
          organizationId,
          deciderOf(ctx.user!),
          input.reason || null,
        ),
      );
    }),

  replyMyself: authenticatedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const organizationId = await assertApprover(ctx.user, ctx.organizationId);
    return toResponse(
      await actionDecisionService.replyMyself(input.id, organizationId, deciderOf(ctx.user!)),
    );
  }),
});
