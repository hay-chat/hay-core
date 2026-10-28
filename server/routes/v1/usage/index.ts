import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { resolutionLedgerService } from "@server/services/resolution-ledger.service";

/**
 * Usage page and resolution ledger (D1-5, D1-6). Owner/admin only: the
 * billing scope is held by the admin wildcard alone.
 */
const monthInput = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .optional();

export const usageRouter = t.router({
  summary: scopedProcedure(RESOURCES.BILLING, ACTIONS.READ)
    .input(z.object({ month: monthInput }))
    .query(({ ctx, input }) => resolutionLedgerService.getUsage(ctx.organizationId!, input.month)),

  ledger: scopedProcedure(RESOURCES.BILLING, ACTIONS.READ)
    .input(
      z.object({
        month: monthInput,
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) => resolutionLedgerService.listLedger(ctx.organizationId!, input)),

  exportCsv: scopedProcedure(RESOURCES.BILLING, ACTIONS.EXPORT)
    .input(z.object({ month: monthInput }))
    .mutation(async ({ ctx, input }) => ({
      csv: await resolutionLedgerService.exportLedgerCsv(ctx.organizationId!, input.month),
    })),

  exclude: scopedProcedure(RESOURCES.BILLING, ACTIONS.UPDATE)
    .input(
      z.object({
        outcomeId: z.string().uuid(),
        reason: z.string().trim().min(3).max(1000),
      }),
    )
    .mutation(({ ctx, input }) => {
      // The audit trail names a person; an API key cannot exclude.
      if (ctx.user!.authMethod === "apikey") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Exclusions must be made by a person" });
      }
      return resolutionLedgerService.exclude({
        organizationId: ctx.organizationId!,
        outcomeId: input.outcomeId,
        userId: ctx.user!.id,
        reason: input.reason,
      });
    }),
});
