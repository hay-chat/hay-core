import { t, scopedProcedure } from "@server/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { insightRunsService } from "@server/services/insights/insight-runs.service";
import {
  insightsService,
  InsightError,
  INSIGHT_STATES,
} from "@server/services/insights/insights.service";
import {
  INSIGHT_ACTION_TYPES,
  INSIGHT_POLARITIES,
} from "@server/services/close-classification/outcome-rules";

function rethrow(error: unknown): never {
  if (error instanceof InsightError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  throw error;
}

/** Insights engine: the Insights page (D3-13) and observability (D3-11). */
export const insightsRouter = t.router({
  metrics: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(z.object({ days: z.number().int().min(1).max(90).default(30) }).default({ days: 30 }))
    .query(({ ctx, input }) => insightRunsService.getMetrics(ctx.organizationId!, input.days)),

  list: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(
      z.object({
        polarity: z.enum(INSIGHT_POLARITIES).optional(),
        state: z.enum([...INSIGHT_STATES, "open", "all"]).default("open"),
        actionType: z.enum(INSIGHT_ACTION_TYPES).optional(),
        days: z.number().int().min(1).max(365).default(30),
        minSize: z.number().int().min(1).max(1000).optional(),
      }),
    )
    .query(({ ctx, input }) => insightsService.list(ctx.organizationId!, input)),

  get: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => insightsService.get(ctx.organizationId!, input.id).catch(rethrow)),

  /** Lifecycle change (acknowledge, start, address, reject with a reason, archive, reopen). */
  setState: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(
      z.object({
        id: z.string().uuid(),
        state: z.enum(INSIGHT_STATES),
        reason: z.string().max(1000).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      insightsService
        .setState({
          organizationId: ctx.organizationId!,
          clusterId: input.id,
          to: input.state,
          userId: ctx.user?.id ?? null,
          reason: input.reason,
        })
        .catch(rethrow),
    ),

  /** Approve: suggestions only. Returns which reviewer the dashboard opens (D3-14). */
  approve: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      insightsService
        .approve({
          organizationId: ctx.organizationId!,
          clusterId: input.id,
          userId: ctx.user?.id ?? null,
        })
        .catch(rethrow),
    ),
});
