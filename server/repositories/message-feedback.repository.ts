import { AppDataSource } from "../database/data-source";
import { MessageFeedback } from "../database/entities/message-feedback.entity";
import { Repository } from "typeorm";
import type { CreateFeedbackInput, FeedbackFilter } from "../types/message-feedback.types";

export class MessageFeedbackRepository {
  private repository: Repository<MessageFeedback>;

  constructor() {
    this.repository = AppDataSource.getRepository(MessageFeedback);
  }

  async create(
    organizationId: string,
    reviewerId: string,
    data: CreateFeedbackInput
  ): Promise<MessageFeedback> {
    const feedback = this.repository.create({
      messageId: data.messageId,
      organizationId,
      reviewerId,
      rating: data.rating,
      comment: data.comment || null,
    });

    return this.repository.save(feedback);
  }

  async findById(id: string): Promise<MessageFeedback | null> {
    return this.repository.findOne({
      where: { id },
      relations: ["message", "message.source", "reviewer"],
    });
  }

  async findByMessage(messageId: string): Promise<MessageFeedback[]> {
    return this.repository.find({
      where: { messageId },
      relations: ["reviewer"],
      order: { createdAt: "DESC" },
    });
  }

  async findByOrganization(
    organizationId: string,
    filter?: FeedbackFilter
  ): Promise<MessageFeedback[]> {
    const query = this.repository
      .createQueryBuilder("feedback")
      .leftJoinAndSelect("feedback.message", "message")
      .leftJoinAndSelect("message.source", "source")
      .leftJoinAndSelect("feedback.reviewer", "reviewer")
      .where("feedback.organization_id = :organizationId", { organizationId });

    if (filter?.messageId) {
      query.andWhere("feedback.message_id = :messageId", {
        messageId: filter.messageId,
      });
    }

    if (filter?.rating) {
      query.andWhere("feedback.rating = :rating", { rating: filter.rating });
    }

    if (filter?.reviewerId) {
      query.andWhere("feedback.reviewer_id = :reviewerId", {
        reviewerId: filter.reviewerId,
      });
    }

    if (filter?.startDate) {
      query.andWhere("feedback.created_at >= :startDate", {
        startDate: filter.startDate,
      });
    }

    if (filter?.endDate) {
      query.andWhere("feedback.created_at <= :endDate", {
        endDate: filter.endDate,
      });
    }

    query.orderBy("feedback.created_at", "DESC");

    return query.getMany();
  }

  async countByRating(organizationId: string): Promise<Record<string, number>> {
    const results = await this.repository
      .createQueryBuilder("feedback")
      .select("feedback.rating", "rating")
      .addSelect("COUNT(*)", "count")
      .where("feedback.organization_id = :organizationId", { organizationId })
      .groupBy("feedback.rating")
      .getRawMany();

    const counts: Record<string, number> = {
      good: 0,
      bad: 0,
      neutral: 0,
    };

    results.forEach((result) => {
      counts[result.rating] = parseInt(result.count, 10);
    });

    return counts;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return (result.affected || 0) > 0;
  }
}
