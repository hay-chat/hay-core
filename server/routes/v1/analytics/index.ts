import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { AnalyticsService } from "../../../services/analytics.service";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import {
  ANALYTICS_REPORTS,
  analyticsReportsService,
  type ReportRange,
} from "@server/services/analytics-reports.service";

const analyticsService = new AnalyticsService();

// Common input schema for all analytics endpoints
const analyticsInputSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const MAX_REPORT_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

/** Reports compare against the previous period, so they need both ends. */
const reportInputSchema = z
  .object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  })
  .refine((input) => new Date(input.endDate).getTime() > new Date(input.startDate).getTime(), {
    message: "The range must end after it starts",
  })
  .refine(
    (input) =>
      new Date(input.endDate).getTime() - new Date(input.startDate).getTime() <=
      MAX_REPORT_RANGE_MS,
    { message: "The range cannot be longer than a year" },
  );

function toRange(input: { startDate: string; endDate: string }): ReportRange {
  return { start: new Date(input.startDate), end: new Date(input.endDate) };
}

export const analyticsRouter = t.router({
  overview: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(reportInputSchema)
    .query(({ ctx, input }) =>
      analyticsReportsService.getOverview(ctx.organizationId!, toRange(input)),
    ),

  csat: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(reportInputSchema)
    .query(({ ctx, input }) =>
      analyticsReportsService.getCsat(ctx.organizationId!, toRange(input)),
    ),

  handoffs: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(reportInputSchema)
    .query(({ ctx, input }) =>
      analyticsReportsService.getHandoffs(ctx.organizationId!, toRange(input)),
    ),

  topics: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(reportInputSchema)
    .query(({ ctx, input }) =>
      analyticsReportsService.getTopics(ctx.organizationId!, toRange(input)),
    ),

  playbooks: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(reportInputSchema)
    .query(({ ctx, input }) =>
      analyticsReportsService.getPlaybooks(ctx.organizationId!, toRange(input)),
    ),

  exportCsv: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.EXPORT)
    .input(reportInputSchema.and(z.object({ report: z.enum(ANALYTICS_REPORTS) })))
    .mutation(async ({ ctx, input }) => ({
      csv: await analyticsReportsService.exportCsv(
        ctx.organizationId!,
        input.report,
        toRange(input),
      ),
    })),

  conversationActivity: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(analyticsInputSchema)
    .query(async ({ ctx, input }) => {
      const activity = await analyticsService.getConversationActivity({
        organizationId: ctx.organizationId!,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      });

      return {
        data: activity,
        filters: {
          startDate: input.startDate,
          endDate: input.endDate,
        },
      };
    }),

  sentimentAnalysis: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(analyticsInputSchema)
    .query(async ({ ctx, input }) => {
      const sentimentData = await analyticsService.getSentimentAnalysis({
        organizationId: ctx.organizationId!,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      });

      return {
        data: sentimentData,
        filters: {
          startDate: input.startDate,
          endDate: input.endDate,
        },
      };
    }),

  conversationMetrics: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(analyticsInputSchema)
    .query(async ({ ctx, input }) => {
      const metrics = await analyticsService.getConversationMetrics({
        organizationId: ctx.organizationId!,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      });

      return {
        data: metrics,
        filters: {
          startDate: input.startDate,
          endDate: input.endDate,
        },
      };
    }),

  documentStatusCounts: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ).query(
    async ({ ctx }) => {
      const data = await analyticsService.getDocumentStatusCounts(ctx.organizationId!);
      return { data };
    },
  ),

  responseTime: scopedProcedure(RESOURCES.ANALYTICS, ACTIONS.READ)
    .input(analyticsInputSchema)
    .query(async ({ ctx, input }) => {
      const responseTimeData = await analyticsService.getResponseTimeAnalytics({
        organizationId: ctx.organizationId!,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      });

      return {
        data: responseTimeData,
        filters: {
          startDate: input.startDate,
          endDate: input.endDate,
        },
      };
    }),
});
