import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { z } from "zod";
import {
  FeedbackMessageNotFoundError,
  MessageFeedbackService,
} from "../../../services/message-feedback.service";
import { FeedbackRating } from "../../../types/message-feedback.types";
import { TRPCError } from "@trpc/server";

const feedbackService = new MessageFeedbackService();

const createFeedbackSchema = z.object({
  messageId: z.string().uuid(),
  rating: z.nativeEnum(FeedbackRating),
  comment: z.string().max(5_000).optional(),
});

const listFeedbackSchema = z.object({
  messageId: z.string().uuid().optional(),
  rating: z.nativeEnum(FeedbackRating).optional(),
  reviewerId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const messageFeedbackRouter = t.router({
  create: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.CREATE)
    .input(createFeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await feedbackService.createFeedback(ctx.organizationId!, ctx.user!.id, input);
      } catch (error) {
        if (error instanceof FeedbackMessageNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }
    }),

  get: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.READ)
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const feedback = await feedbackService.getFeedbackById(input.id);

      if (!feedback || feedback.organizationId !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Feedback not found",
        });
      }

      return feedback;
    }),

  getByMessage: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.READ)
    .input(z.object({ messageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const feedback = await feedbackService.getFeedbackByMessage(input.messageId);
      // Filter to only return feedback from the user's organization
      return feedback.filter((f) => f.organizationId === ctx.organizationId);
    }),

  list: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.READ)
    .input(listFeedbackSchema)
    .query(async ({ ctx, input }) => {
      const filter = {
        messageId: input.messageId,
        rating: input.rating,
        reviewerId: input.reviewerId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const feedback = await feedbackService.getFeedbackByOrganization(ctx.organizationId!, filter);

      return feedback;
    }),

  stats: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.READ).query(async ({ ctx }) => {
    const stats = await feedbackService.getFeedbackStats(ctx.organizationId!);
    return stats;
  }),

  export: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.READ)
    .input(listFeedbackSchema)
    .query(async ({ ctx, input }) => {
      const filter = {
        messageId: input.messageId,
        rating: input.rating,
        reviewerId: input.reviewerId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const csv = await feedbackService.exportFeedbackToCSV(ctx.organizationId!, filter);
      return { csv };
    }),

  delete: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.DELETE)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership before deletion
      const feedback = await feedbackService.getFeedbackById(input.id);
      if (!feedback || feedback.organizationId !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Feedback not found",
        });
      }

      const success = await feedbackService.deleteFeedback(input.id);

      if (!success) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Feedback not found",
        });
      }

      return { success: true };
    }),
});
