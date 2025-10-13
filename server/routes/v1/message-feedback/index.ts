import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { MessageFeedbackService } from "../../../services/message-feedback.service";
import { FeedbackRating } from "../../../types/message-feedback.types";
import { TRPCError } from "@trpc/server";

const feedbackService = new MessageFeedbackService();

const createFeedbackSchema = z.object({
  messageId: z.string().uuid(),
  rating: z.nativeEnum(FeedbackRating),
  comment: z.string().optional(),
});

const listFeedbackSchema = z.object({
  messageId: z.string().uuid().optional(),
  rating: z.nativeEnum(FeedbackRating).optional(),
  reviewerId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const messageFeedbackRouter = t.router({
  create: authenticatedProcedure
    .input(createFeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      const feedback = await feedbackService.createFeedback(
        ctx.organizationId!,
        ctx.user!.id,
        input
      );
      return feedback;
    }),

  get: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const feedback = await feedbackService.getFeedbackById(input.id);

      if (!feedback) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Feedback not found",
        });
      }

      return feedback;
    }),

  getByMessage: authenticatedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .query(async ({ input }) => {
      const feedback = await feedbackService.getFeedbackByMessage(input.messageId);
      return feedback;
    }),

  list: authenticatedProcedure.input(listFeedbackSchema).query(async ({ ctx, input }) => {
    const filter = {
      messageId: input.messageId,
      rating: input.rating,
      reviewerId: input.reviewerId,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
    };

    const feedback = await feedbackService.getFeedbackByOrganization(
      ctx.organizationId!,
      filter
    );

    return feedback;
  }),

  stats: authenticatedProcedure.query(async ({ ctx }) => {
    const stats = await feedbackService.getFeedbackStats(ctx.organizationId!);
    return stats;
  }),

  export: authenticatedProcedure.input(listFeedbackSchema).query(async ({ ctx, input }) => {
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

  delete: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
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
