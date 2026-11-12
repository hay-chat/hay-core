import { In } from "typeorm";
import { MessageFeedbackRepository } from "../repositories/message-feedback.repository";
import { MessageFeedback } from "../database/entities/message-feedback.entity";
import { InsightIssue } from "../database/entities/insight-issue.entity";
import { MessageType } from "../database/entities/message.entity";
import type { Conversation } from "../database/entities/conversation.entity";
import { AppDataSource } from "../database/data-source";
import {
  DeliveryState,
  FeedbackRating,
  FeedbackSource,
  type CreateFeedbackInput,
  type FeedbackFilter,
} from "../types/message-feedback.types";
import { feedbackInsightService, findRatedMessage } from "./insights/feedback-insight.service";

/** The rated message does not exist in the caller's organization. */
export class FeedbackMessageNotFoundError extends Error {
  constructor() {
    super("Message not found");
  }
}

/** A team member's rating: always has a reviewer. */
export type OperatorFeedback = MessageFeedback & { reviewerId: string };

/** The webchat widget's thumbs up/down. */
export type VisitorRating = "up" | "down";

const RATING_BY_VISITOR_RATING: Record<VisitorRating, FeedbackRating> = {
  up: FeedbackRating.GOOD,
  down: FeedbackRating.BAD,
};

export class MessageFeedbackService {
  private feedbackRepository: MessageFeedbackRepository;

  constructor() {
    this.feedbackRepository = new MessageFeedbackRepository();
  }

  async createFeedback(
    organizationId: string,
    reviewerId: string,
    data: CreateFeedbackInput,
  ): Promise<OperatorFeedback> {
    // The rating and its insight issue (D3-9) are written together.
    return AppDataSource.transaction(async (manager) => {
      const rated = await findRatedMessage(organizationId, data.messageId, manager);
      if (!rated) throw new FeedbackMessageNotFoundError();
      const repository = manager.getRepository(MessageFeedback);
      const feedback = await repository.save(
        repository.create({
          messageId: data.messageId,
          organizationId,
          reviewerId,
          source: FeedbackSource.OPERATOR,
          rating: data.rating,
          comment: data.comment || null,
        }),
      );
      await feedbackInsightService.createPendingIssue(feedback, rated, manager);
      return { ...feedback, reviewerId };
    });
  }

  /**
   * The visitor rates an AI answer of their own conversation. Only answers
   * the widget showed them (BotAgent, sent) can be rated. Rating again
   * replaces the earlier rating and its insight issue.
   */
  async rateAsVisitor(
    conversation: Pick<Conversation, "id" | "organization_id">,
    messageId: string,
    rating: VisitorRating,
  ): Promise<MessageFeedback> {
    const organizationId = conversation.organization_id;
    return AppDataSource.transaction(async (manager) => {
      const rated = await findRatedMessage(organizationId, messageId, manager);
      if (
        !rated ||
        rated.conversation.id !== conversation.id ||
        rated.message.type !== MessageType.BOT_AGENT ||
        rated.message.deliveryState !== DeliveryState.SENT
      ) {
        throw new FeedbackMessageNotFoundError();
      }

      const repository = manager.getRepository(MessageFeedback);
      const previous = await repository.find({
        where: { messageId, source: FeedbackSource.VISITOR },
        select: { id: true },
      });
      if (previous.length > 0) {
        const ids = previous.map((row) => row.id);
        await manager.getRepository(InsightIssue).delete({ message_feedback_id: In(ids) });
        await repository.delete({ id: In(ids) });
      }

      const feedback = await repository.save(
        repository.create({
          messageId,
          organizationId,
          reviewerId: null,
          source: FeedbackSource.VISITOR,
          rating: RATING_BY_VISITOR_RATING[rating],
          comment: null,
        }),
      );
      await feedbackInsightService.createPendingIssue(feedback, rated, manager);
      return feedback;
    });
  }

  async getFeedbackById(id: string, organizationId: string): Promise<MessageFeedback | null> {
    return this.feedbackRepository.findByIdAndOrganization(id, organizationId);
  }

  /** The team's ratings of a message (the dashboard's own feedback control). */
  async getOperatorFeedbackByMessage(messageId: string): Promise<OperatorFeedback[]> {
    const feedback = await this.feedbackRepository.findByMessage(messageId);
    return feedback.filter(
      (f): f is OperatorFeedback => f.source === FeedbackSource.OPERATOR && f.reviewerId !== null,
    );
  }

  async getFeedbackByOrganization(
    organizationId: string,
    filter?: FeedbackFilter,
  ): Promise<MessageFeedback[]> {
    return this.feedbackRepository.findByOrganization(organizationId, filter);
  }

  async getFeedbackStats(organizationId: string): Promise<{
    total: number;
    byRating: Record<string, number>;
    percentages: Record<string, number>;
  }> {
    const byRating = await this.feedbackRepository.countByRating(organizationId);
    const total = Object.values(byRating).reduce((sum, count) => sum + count, 0);

    const percentages: Record<string, number> = {};
    if (total > 0) {
      Object.entries(byRating).forEach(([rating, count]) => {
        percentages[rating] = Math.round((count / total) * 100);
      });
    }

    return {
      total,
      byRating,
      percentages,
    };
  }

  /**
   * Withdraw a rating: its insight issue goes too. (Retention deleting the
   * message cascades to the feedback but keeps the issue, via SET NULL.)
   */
  async deleteFeedback(id: string): Promise<boolean> {
    await AppDataSource.getRepository(InsightIssue).delete({ message_feedback_id: id });
    return this.feedbackRepository.delete(id);
  }

  async exportFeedbackToCSV(organizationId: string, filter?: FeedbackFilter): Promise<string> {
    const feedback = await this.feedbackRepository.findByOrganization(organizationId, filter);

    // CSV headers
    const headers = [
      "ID",
      "Message ID",
      "Rating",
      "Comment",
      "Source",
      "Given By",
      "Reviewer",
      "Created At",
    ];

    // CSV rows
    const rows = feedback.map((f) => [
      f.id,
      f.messageId,
      f.rating,
      f.comment || "",
      f.message?.source?.name || "",
      f.source,
      f.reviewer?.email || "",
      f.createdAt.toISOString(),
    ]);

    // Convert to CSV format
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    return csvContent;
  }
}
