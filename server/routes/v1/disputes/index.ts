import { z } from "zod";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { disputesService } from "@server/services/disputes/disputes.service";
import type { Dispute } from "@server/database/entities/dispute.entity";

/**
 * Payment disputes (D2-7 / D2-8) reported by payment-platform plugins. The
 * merchant attaches the evidence pack as a DRAFT with one click; Hay.chat
 * never submits the response, the merchant does on the platform. Every plan.
 */

const platformName = (pluginId: string | null) =>
  pluginId ? (pluginManagerService.getPlugin(pluginId)?.name ?? pluginId) : null;

function toResponse(dispute: Dispute) {
  return {
    id: dispute.id,
    pluginId: dispute.pluginId,
    platform: platformName(dispute.pluginId),
    status: dispute.status,
    amount: dispute.amount,
    currency: dispute.currency,
    reason: dispute.reason,
    evidenceDueBy: dispute.evidenceDueBy,
    orderLabel: dispute.orderLabel,
    orderKey: dispute.orderKey,
    orderPluginId: dispute.orderPluginId,
    providerUrl: dispute.providerUrl,
    evidenceStatus: dispute.evidenceStatus,
    evidencePushedAt: dispute.evidencePushedAt,
    evidenceError: dispute.evidenceError,
    createdAt: dispute.createdAt,
  };
}

export const disputesRouter = t.router({
  list: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ).query(async ({ ctx }) => {
    const disputes = await disputesService.list(ctx.organizationId!);
    return { disputes: disputes.map(toResponse) };
  }),

  /** Attach the evidence pack to the dispute on its platform, as a draft. Never submits. */
  attachEvidence: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ disputeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return disputesService.attachEvidence(
        ctx.organizationId!,
        input.disputeId,
        ctx.user?.id ?? null,
      );
    }),
});
