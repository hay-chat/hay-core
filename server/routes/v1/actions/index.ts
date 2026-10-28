import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { t, authenticatedProcedure, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import type { AuthUser } from "@server/lib/auth/AuthUser";
import { organizationRepository } from "@server/repositories/organization.repository";
import { resolveActionApprovalConfig } from "@server/types/organization-settings.types";
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

function toResponse({ action, transitioned }: DecisionResult) {
  if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "Action not found" });
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

  approve: authenticatedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const organizationId = await assertApprover(ctx.user, ctx.organizationId);
    return toResponse(
      await actionDecisionService.approve(input.id, organizationId, deciderOf(ctx.user!)),
    );
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
