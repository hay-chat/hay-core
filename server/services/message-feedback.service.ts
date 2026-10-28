import { MessageFeedbackRepository } from "../repositories/message-feedback.repository";
import { MessageFeedback } from "../database/entities/message-feedback.entity";
import { InsightIssue } from "../database/entities/insight-issue.entity";
import { AppDataSource } from "../database/data-source";
import type { CreateFeedbackInput, FeedbackFilter } from "../types/message-feedback.types";
import { feedbackInsightService, findRatedMessage } from "./insights/feedback-insight.service";

/** The rated message does not exist in the caller's organization. */
export class FeedbackMessageNotFoundError extends Error {
  constructor() {
    super("Message not found");
  }
}

export class MessageFeedbackService {
  private feedbackRepository: MessageFeedbackRepository;

  constructor() {
    this.feedbackRepository = new MessageFeedbackRepository();
  }

  async createFeedback(
    organizationId: string,
    reviewerId: string,
    data: CreateFeedbackInput,
  ): Promise<MessageFeedback> {
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
          rating: data.rating,
          comment: data.comment || null,
        }),
      );
      await feedbackInsightService.createPendingIssue(feedback, rated, manager);
      return feedback;
    });
  }

  async getFeedbackById(id: string): Promise<MessageFeedback | null> {
    return this.feedbackRepository.findById(id);
  }

  async getFeedbackByMessage(messageId: string): Promise<MessageFeedback[]> {
    return this.feedbackRepository.findByMessage(messageId);
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
    const headers = ["ID", "Message ID", "Rating", "Comment", "Source", "Reviewer", "Created At"];

    // CSV rows
    const rows = feedback.map((f) => [
      f.id,
      f.messageId,
      f.rating,
      f.comment || "",
      f.message?.source?.name || "",
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
