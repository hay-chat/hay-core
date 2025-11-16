import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { AnalyticsService } from "../../../services/analytics.service";
import { RESOURCES, ACTIONS } from "@server/types/scopes";

const analyticsService = new AnalyticsService();

// Common input schema for all analytics endpoints
const analyticsInputSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const analyticsRouter = t.router({
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