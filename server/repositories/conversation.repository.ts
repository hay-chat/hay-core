import { Repository, SelectQueryBuilder, In } from "typeorm";
import { Conversation } from "../database/entities/conversation.entity";
import { AppDataSource } from "../database/data-source";
import { BaseRepository } from "./base.repository";
import type { ListParams } from "../trpc/middleware/pagination";
import { Message, MessageType } from "@server/database/entities/message.entity";

export class ConversationRepository extends BaseRepository<Conversation> {
  private messageRepository!: Repository<Message>;

  constructor() {
    super(Conversation);
  }

  private getMessageRepository(): Repository<Message> {
    if (!this.messageRepository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(`Database not initialized. Cannot access Message repository.`);
      }
      this.messageRepository = AppDataSource.getRepository(Message);
    }
    return this.messageRepository;
  }

  /**
   * Override base methods to handle organization_id field naming
   */
  override async create(data: Partial<Conversation>): Promise<Conversation> {
    const conversation = this.getRepository().create(data);
    return await this.getRepository().save(conversation);
  }

  override async findById(id: string): Promise<Conversation | null> {
    const queryBuilder = this.getRepository().createQueryBuilder("conversation");

    queryBuilder.where("conversation.id = :id", { id });

    queryBuilder
      .leftJoinAndSelect("conversation.messages", "messages")
      .orderBy("messages.created_at", "ASC");

    return await queryBuilder.getOne();
  }

  async findByAgent(agentId: string, organizationId: string): Promise<Conversation[]> {
    return await this.getRepository().find({
      where: { agent_id: agentId, organization_id: organizationId },
      order: { created_at: "DESC" },
    });
  }

  override async findByOrganization(organizationId: string): Promise<Conversation[]> {
    return await this.getRepository().find({
      where: { organization_id: organizationId },
      order: { created_at: "DESC" },
    });
  }

  override async update(
    id: string,
    organizationId: string,
    data: Partial<Conversation>,
  ): Promise<Conversation | null> {
    // For single conversation updates, organizationId is optional for security
    // but we still validate it exists if provided
    const conversation = await this.findById(id);
    if (!conversation || conversation.organization_id !== organizationId) {
      return null;
    }

    await this.getRepository().update({ id }, data as any);

    return await this.findById(id);
  }

  // Simple update method for internal use (orchestrator, etc.)
  async updateById(id: string, data: Partial<Conversation>): Promise<Conversation | null> {
    const conversation = await this.findById(id);
    if (!conversation) {
      return null;
    }

    await this.getRepository().update({ id }, data as any);

    return await this.findById(id);
  }

  /**
   * Get conversations that are available for processing
   * Includes both open conversations and stuck processing conversations (past lock expiry)
   */
  async getAvailableForProcessing(): Promise<Conversation[]> {
    if (!this.getRepository()) {
      console.error("[ConversationRepository] Repository not initialized");
      return [];
    }

    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      const queryBuilder = this.getRepository().createQueryBuilder("conversation");

      // Only select conversations that are truly available for processing
      queryBuilder.where(
        "(conversation.status = :openStatus OR " +
          "(conversation.status = :processingStatus AND conversation.processing_locked_until < :fiveMinutesAgo)) AND " +
          "(conversation.processing_locked_until IS NULL OR conversation.processing_locked_until < :fiveMinutesAgo)",
        {
          openStatus: "open",
          processingStatus: "processing",
          fiveMinutesAgo,
        },
      );

      queryBuilder.leftJoinAndSelect("conversation.messages", "messages");
      queryBuilder.orderBy("conversation.created_at", "ASC");

      return await queryBuilder.getMany();
    } catch (error) {
      console.error("[ConversationRepository] Error getting available conversations:", error);
      return [];
    }
  }

  override async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.getRepository().delete({
      id,
      organization_id: organizationId,
    });

    return result.affected !== 0;
  }

  /**
   * Override pagination method to handle organization_id field naming
   */
  override async paginateQuery(
    listParams: ListParams,
    organizationId: string,
    baseWhere?: Record<string, unknown>,
  ) {
    const queryBuilder = this.getRepository().createQueryBuilder("entity");

    // Use organization_id instead of organizationId for conversations
    queryBuilder.where("entity.organization_id = :organizationId", {
      organizationId,
    });

    // Add base where conditions if provided
    if (baseWhere) {
      Object.entries(baseWhere).forEach(([key, value], index) => {
        queryBuilder.andWhere(`entity.${key} = :baseWhere${index}`, {
          [`baseWhere${index}`]: value,
        });
      });
    }

    // Apply conversation-specific filters
    this.applyFilters(queryBuilder, listParams.filters, organizationId);

    // Apply search
    this.applySearch(queryBuilder, listParams.search);

    // Apply date range
    this.applyDateRange(queryBuilder, listParams.dateRange);

    // Apply sorting
    this.applySorting(queryBuilder, listParams.sorting);

    // Apply includes/relations
    this.applyIncludes(queryBuilder, listParams.include);

    // Get total count before applying pagination
    const total = await queryBuilder.getCount();

    // Apply pagination
    queryBuilder.skip(listParams.pagination.offset).take(listParams.pagination.limit);

    // Apply select fields if specified
    if (listParams.select && listParams.select.length > 0) {
      const selectFields = listParams.select.map((field: string) => `entity.${field}`);
      queryBuilder.select(selectFields);
    }

    // Execute query
    const items = await queryBuilder.getMany();

    return {
      items,
      pagination: {
        page: listParams.pagination.page,
        limit: listParams.pagination.limit,
        total,
        totalPages: Math.ceil(total / listParams.pagination.limit),
        hasNext: listParams.pagination.page < Math.ceil(total / listParams.pagination.limit),
        hasPrev: listParams.pagination.page > 1,
      },
    };
  }

  /**
   * Apply conversation-specific filters
   */
  protected override applyFilters(
    queryBuilder: SelectQueryBuilder<Conversation>,
    filters?: Record<string, unknown>,
    _organizationId?: string,
  ): void {
    if (!filters) return;

    if (filters.status) {
      queryBuilder.andWhere("entity.status = :status", {
        status: filters.status,
      });
    }

    if (filters.agentId) {
      queryBuilder.andWhere("entity.agent_id = :agentId", {
        agentId: filters.agentId,
      });
    }

    if (filters.playbookId) {
      queryBuilder.andWhere("entity.playbook_id = :playbookId", {
        playbookId: filters.playbookId,
      });
    }

    if (filters.hasMessages !== undefined) {
      if (filters.hasMessages) {
        queryBuilder.andWhere(
          "EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = entity.id)",
        );
      } else {
        queryBuilder.andWhere(
          "NOT EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = entity.id)",
        );
      }
    }
  }

  /**
   * Apply conversation-specific search functionality
   */
  protected override applySearch(
    queryBuilder: SelectQueryBuilder<Conversation>,
    search?: { query?: string; searchFields?: string[] },
  ): void {
    if (!search?.query) return;

    // Default search fields for conversations
    const searchFields = search.searchFields || ["title"];

    const searchConditions = searchFields
      .map((field, index) => `entity.${field} ILIKE :searchQuery${index}`)
      .join(" OR ");

    if (searchConditions) {
      queryBuilder.andWhere(
        `(${searchConditions})`,
        searchFields.reduce(
          (params, _, index) => {
            params[`searchQuery${index}`] = `%${search.query}%`;
            return params;
          },
          {} as Record<string, string>,
        ),
      );
    }
  }

  /**
   * Apply conversation-specific includes/relations
   */
  protected override applyIncludes(
    queryBuilder: SelectQueryBuilder<Conversation>,
    include?: string[],
  ): void {
    if (!include || include.length === 0) return;

    include.forEach((relation) => {
      switch (relation) {
        case "messages":
          queryBuilder.leftJoinAndSelect("entity.messages", "messages");
          break;
        case "agent":
          queryBuilder.leftJoinAndSelect("entity.agent", "agent");
          break;
        case "organization":
          queryBuilder.leftJoinAndSelect("entity.organization", "organization");
          break;
        default:
          // Try to apply generic relation
          try {
            queryBuilder.leftJoinAndSelect(`entity.${relation}`, relation);
          } catch (error) {
            console.warn(`Invalid relation '${relation}' for Conversation entity`);
          }
      }
    });
  }

  async findReadyForProcessing(): Promise<Conversation[]> {
    const query = this.getRepository()
      .createQueryBuilder("conversation")
      .where("conversation.needs_processing = :needsProcessing", {
        needsProcessing: true,
      })
      .andWhere("conversation.status IN (:...statuses)", {
        statuses: ["open", "processing"],
      })
      .andWhere("(conversation.cooldown_until IS NULL OR conversation.cooldown_until <= :now)", {
        now: new Date(),
      });

    const results = await query.getMany();

    return results;
  }

  async findAllOpenConversations(): Promise<Conversation[]> {
    return await this.getRepository().find({
      where: { status: "open" },
      order: { created_at: "DESC" },
    });
  }

  async getPublicMessages(conversationId: string): Promise<Message[]> {
    const messageRepository = this.getMessageRepository();
    return await messageRepository.find({
      where: {
        conversation_id: conversationId,
        type: In([MessageType.CUSTOMER, MessageType.BOT_AGENT, MessageType.HUMAN_AGENT]),
      },
      order: { created_at: "ASC" },
    });
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const messageRepository = this.getMessageRepository();
    return await messageRepository.find({
      where: {
        conversation_id: conversationId,
      },
      order: { created_at: "ASC" },
    });
  }

  async getLastHumanMessage(conversationId: string): Promise<Message | null> {
    const conversation = await this.getRepository().findOne({
      where: { id: conversationId },
      relations: ["messages"],
    });

    if (!conversation?.messages) return null;

    return (
      conversation.messages
        .filter((msg) => msg.type === MessageType.CUSTOMER)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0] || null
    );
  }

  async getSystemMessages(conversationId: string): Promise<Message[]> {
    const messageRepository = this.getMessageRepository();
    return await messageRepository.find({
      where: {
        conversation_id: conversationId,
        type: MessageType.SYSTEM,
      },
      order: { created_at: "ASC" },
    });
  }

  async getBotMessages(conversationId: string): Promise<Message[]> {
    const messageRepository = this.getMessageRepository();
    return await messageRepository.find({
      where: {
        conversation_id: conversationId,
        type: MessageType.BOT_AGENT,
      },
      order: { created_at: "ASC" },
    });
  }

  async getDailyStats(
    organizationId: string,
    days: number = 30,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Array<{ date: string; count: number; label: string }>> {
    const end = endDate || new Date();
    const start = startDate || new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    // Adjust dates to start and end of day in UTC
    const startOfDay = new Date(start);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(end);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const query = `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM conversations 
      WHERE organization_id = $1 
        AND created_at >= $2 
        AND created_at <= $3
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `;

    const rawResults = await this.getRepository().query(query, [
      organizationId,
      startOfDay.toISOString(),
      endOfDay.toISOString(),
    ]);

    // Create a map of date -> count for existing data
    const dataMap = new Map<string, number>();
    interface DateCountRow {
      date: Date | string;
      count: string | number;
    }
    rawResults.forEach((row: DateCountRow) => {
      const dateStr =
        row.date instanceof Date ? row.date.toISOString().split("T")[0] : row.date.split(" ")[0]; // Handle different date formats from DB
      dataMap.set(dateStr, parseInt(row.count as string, 10));
    });

    // Generate all dates in range and fill missing dates with 0
    const result: Array<{ date: string; count: number; label: string }> = [];
    const currentDate = new Date(startOfDay);

    while (currentDate <= endOfDay) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const count = dataMap.get(dateStr) || 0;

      // Format label as "MMM DD"
      const label = currentDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      result.push({
        date: dateStr,
        count,
        label,
      });

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return result;
  }

  async countByFilters(filters: {
    organizationId: string;
    startDate?: Date;
    endDate?: Date;
    status?: string;
  }): Promise<number> {
    const queryBuilder = this.getRepository()
      .createQueryBuilder("conversation")
      .where("conversation.organization_id = :organizationId", { organizationId: filters.organizationId });

    if (filters.startDate) {
      queryBuilder.andWhere("conversation.created_at >= :startDate", { startDate: filters.startDate });
    }

    if (filters.endDate) {
      queryBuilder.andWhere("conversation.created_at <= :endDate", { endDate: filters.endDate });
    }

    if (filters.status) {
      queryBuilder.andWhere("conversation.status = :status", { status: filters.status });
    }

    return await queryBuilder.getCount();
  }
}

export const conversationRepository = new ConversationRepository();
