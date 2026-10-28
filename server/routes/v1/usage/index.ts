import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import {
  USAGE_PERIODS_SHOWN,
  resolutionLedgerService,
} from "@server/services/resolution-ledger.service";

/**
 * Usage page and resolution ledger (D1-5, D1-6). Owner/admin only: the
 * billing scope is held by the admin wildcard alone.
 */
/** Billing periods back from the current one (0 = current). */
const periodInput = z
  .number()
  .int()
  .min(0)
  .max(USAGE_PERIODS_SHOWN - 1)
  .default(0);

export const usageRouter = t.router({
  periods: scopedProcedure(RESOURCES.BILLING, ACTIONS.READ).query(({ ctx }) =>
    resolutionLedgerService.listPeriods(ctx.organizationId!),
  ),

  summary: scopedProcedure(RESOURCES.BILLING, ACTIONS.READ)
    .input(z.object({ period: periodInput }))
    .query(({ ctx, input }) => resolutionLedgerService.getUsage(ctx.organizationId!, input.period)),

  ledger: scopedProcedure(RESOURCES.BILLING, ACTIONS.READ)
    .input(
      z.object({
        period: periodInput,
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) => resolutionLedgerService.listLedger(ctx.organizationId!, input)),

  exportCsv: scopedProcedure(RESOURCES.BILLING, ACTIONS.EXPORT)
    .input(z.object({ period: periodInput }))
    .mutation(async ({ ctx, input }) => ({
      csv: await resolutionLedgerService.exportLedgerCsv(ctx.organizationId!, input.period),
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
