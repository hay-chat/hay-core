import { Repository, IsNull } from "typeorm";
import { AppDataSource } from "../database/data-source";
import { ConversationTakeoverEvent } from "../database/entities/conversation-takeover-event.entity";

export class ConversationTakeoverEventRepository {
  private repository!: Repository<ConversationTakeoverEvent>;

  private getRepository(): Repository<ConversationTakeoverEvent> {
    if (!this.repository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(
          "Database not initialized. Cannot access ConversationTakeoverEvent repository.",
        );
      }
      this.repository = AppDataSource.getRepository(ConversationTakeoverEvent);
    }
    return this.repository;
  }

  async startTakeover(params: {
    organizationId: string;
    conversationId: string;
    userId: string;
    startedAt?: Date;
  }): Promise<ConversationTakeoverEvent> {
    const repo = this.getRepository();
    const event = repo.create({
      organization_id: params.organizationId,
      conversation_id: params.conversationId,
      user_id: params.userId,
      started_at: params.startedAt ?? new Date(),
      ended_at: null,
      duration_seconds: null,
    });
    return await repo.save(event);
  }

  async endMostRecentOpenTakeover(params: {
    organizationId: string;
    conversationId: string;
    endedAt?: Date;
  }): Promise<ConversationTakeoverEvent | null> {
    const repo = this.getRepository();
    const endedAt = params.endedAt ?? new Date();

    const open = await repo.findOne({
      where: {
        organization_id: params.organizationId,
        conversation_id: params.conversationId,
        ended_at: IsNull(),
      },
      order: { started_at: "DESC" },
    });

    if (!open) return null;

    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - new Date(open.started_at).getTime()) / 1000),
    );

    open.ended_at = endedAt;
    open.duration_seconds = durationSeconds;
    return await repo.save(open);
  }
}

export const conversationTakeoverEventRepository = new ConversationTakeoverEventRepository();
