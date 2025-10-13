import { MessageFeedbackRepository } from "../repositories/message-feedback.repository";
import { MessageFeedback } from "../database/entities/message-feedback.entity";
import type { CreateFeedbackInput, FeedbackFilter } from "../types/message-feedback.types";

export class MessageFeedbackService {
  private feedbackRepository: MessageFeedbackRepository;

  constructor() {
    this.feedbackRepository = new MessageFeedbackRepository();
  }

  async createFeedback(
    organizationId: string,
    reviewerId: string,
    data: CreateFeedbackInput
  ): Promise<MessageFeedback> {
    return this.feedbackRepository.create(organizationId, reviewerId, data);
  }

  async getFeedbackById(id: string): Promise<MessageFeedback | null> {
    return this.feedbackRepository.findById(id);
  }

  async getFeedbackByMessage(messageId: string): Promise<MessageFeedback[]> {
    return this.feedbackRepository.findByMessage(messageId);
  }

  async getFeedbackByOrganization(
    organizationId: string,
    filter?: FeedbackFilter
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

  async deleteFeedback(id: string): Promise<boolean> {
    return this.feedbackRepository.delete(id);
  }

  async exportFeedbackToCSV(
    organizationId: string,
    filter?: FeedbackFilter
  ): Promise<string> {
    const feedback = await this.feedbackRepository.findByOrganization(
      organizationId,
      filter
    );

    // CSV headers
    const headers = [
      "ID",
      "Message ID",
      "Rating",
      "Comment",
      "Source",
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
      f.reviewer?.email || "",
      f.createdAt.toISOString(),
    ]);

    // Convert to CSV format
    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    return csvContent;
  }
}
