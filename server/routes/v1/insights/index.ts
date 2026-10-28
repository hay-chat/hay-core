import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { insightRunsService } from "@server/services/insights/insight-runs.service";

/** Insights engine observability (D3-11): volume, job health and estimated LLM cost. */
export const insightsRouter = t.router({
  metrics: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(z.object({ days: z.number().int().min(1).max(90).default(30) }).default({ days: 30 }))
    .query(({ ctx, input }) => insightRunsService.getMetrics(ctx.organizationId!, input.days)),
});
