import { Brackets, Repository, SelectQueryBuilder, In } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { Conversation } from "../database/entities/conversation.entity";
import { ConversationOutcome } from "../database/entities/conversation-outcome.entity";
import { CLOSED_STATUSES } from "../services/close-classification/outcome-rules";
import { AppDataSource } from "../database/data-source";
import { BaseRepository } from "./base.repository";
import type { ListParams } from "../trpc/middleware/pagination";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import { AGENT_SYSTEM_EVENTS } from "@server/services/webchat/public-message";
import { notSimulationSql } from "../services/simulation/simulation-kind";

const LOCK_DURATION_MS = 15_000;

const logger = createLogger("conversation-repo");

const HANDOFF_STATUSES: ReadonlyArray<Conversation["status"]> = [
  "pending-human",
  "human-took-over",
];

/**
 * Adds handed_off_at on the first move into a human status. Lives here rather
 * than in each caller (orchestrator, takeover, plugin API, recovery) because
 * update/updateById/create are the one place every status write passes and
 * the previous row is known.
 */
function withHandoffStamp(
  previous: Pick<Conversation, "handed_off_at"> | null,
  data: Partial<Conversation>,
): Partial<Conversation> {
  if (!data.status || !HANDOFF_STATUSES.includes(data.status)) return data;
  if (previous?.handed_off_at || data.handed_off_at) return data;
  return { ...data, handed_off_at: new Date() };
}

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
    const conversation = this.getRepository().create(withHandoffStamp(null, data));
    const savedConversation = await this.getRepository().save(conversation);

    // Broadcast conversation created event
    const { conversationEventsService } = await import("../services/conversation-events.service");
    await conversationEventsService.broadcastConversationCreated(savedConversation);

    return savedConversation;
  }

  /**
   * @deprecated Use findByIdAndOrganization instead to ensure proper organization scoping
   */
  override async findById(id: string): Promise<Conversation | null> {
    const queryBuilder = this.getRepository().createQueryBuilder("conversation");

    queryBuilder.where("conversation.id = :id", { id });

    queryBuilder
      .leftJoinAndSelect("conversation.messages", "messages")
      .leftJoinAndSelect("conversation.agent", "agent")
      .leftJoinAndSelect("conversation.organization", "organization")
      .leftJoinAndSelect("conversation.customer", "customer")
      .orderBy("messages.created_at", "ASC");

    return await queryBuilder.getOne();
  }

  /**
   * Find conversation by ID and organizationId - ensures proper organization scoping
   */
  override async findByIdAndOrganization(
    id: string,
    organizationId: string,
  ): Promise<Conversation | null> {
    const queryBuilder = this.getRepository().createQueryBuilder("conversation");

    queryBuilder.where("conversation.id = :id AND conversation.organization_id = :organizationId", {
      id,
      organizationId,
    });

    queryBuilder
      .leftJoinAndSelect("conversation.messages", "messages")
      .leftJoinAndSelect("conversation.agent", "agent")
      .leftJoinAndSelect("conversation.organization", "organization")
      .leftJoinAndSelect("conversation.customer", "customer")
      .orderBy("messages.created_at", "ASC");

    return await queryBuilder.getOne();
  }

  async findByAgent(agentId: string, organizationId: string): Promise<Conversation[]> {
    return await this.getRepository()
      .createQueryBuilder("conversation")
      .where("conversation.agent_id = :agentId", { agentId })
      .andWhere("conversation.organization_id = :organizationId", { organizationId })
      .andWhere("conversation.deleted_at IS NULL")
      .andWhere(notSimulationSql("conversation"))
      .orderBy("conversation.created_at", "DESC")
      .getMany();
  }

  override async findByOrganization(organizationId: string): Promise<Conversation[]> {
    return await this.getRepository()
      .createQueryBuilder("conversation")
      .where("conversation.organization_id = :organizationId", { organizationId })
      .andWhere("conversation.deleted_at IS NULL")
      .andWhere(notSimulationSql("conversation"))
      .orderBy("conversation.created_at", "DESC")
      .getMany();
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

    await this.getRepository().update(
      { id },
      withHandoffStamp(conversation, data) as QueryDeepPartialEntity<Conversation>,
    );

    const updatedConversation = await this.findById(id);

    // Broadcast conversation updated event
    if (updatedConversation) {
      const { conversationEventsService } = await import("../services/conversation-events.service");
      const changedFields = Object.keys(data);
      await conversationEventsService.broadcastConversationUpdated(
        updatedConversation,
        changedFields,
      );
      this.notifyDevicesOnTransition(conversation.status, updatedConversation);
      await this.recordCloseOnTransition(conversation.status, updatedConversation);
    }

    return updatedConversation;
  }

  /**
   * Push alerts fire only on a real status transition (not on re-saves of the
   * same status) and never block the caller: the orchestrator loop, takeover
   * and release all await update(), and push endpoints are remote HTTPS calls.
   */
  private notifyDevicesOnTransition(previousStatus: string, updated: Conversation): void {
    if (updated.status === previousStatus) return;
    void import("../services/conversation-alert.service")
      .then(({ conversationAlertService }) =>
        conversationAlertService.onConversationStatusChanged(updated),
      )
      .catch((error) => {
        logger.warn({ err: error, conversationId: updated.id }, "Push alert failed");
      });
  }

  /**
   * Entering a closed status from an open one is a close: record its billing
   * outcome (D1-3). Moves between closed statuses (resolved -> closed by
   * staff, resolved -> unresolved by the classifier) are not new closes.
   */
  private async recordCloseOnTransition(
    previousStatus: string,
    updated: Conversation,
  ): Promise<void> {
    if (CLOSED_STATUSES.includes(previousStatus as Conversation["status"])) return;
    if (!CLOSED_STATUSES.includes(updated.status)) return;
    const { closeClassifierService } =
      await import("../services/close-classification/close-classifier.service");
    await closeClassifierService.recordClose(updated, updated.messages ?? []);
  }

  // Simple update method for internal use (orchestrator, etc.)
  async updateById(id: string, data: Partial<Conversation>): Promise<Conversation | null> {
    const conversation = await this.findById(id);
    if (!conversation) {
      return null;
    }

    await this.getRepository().update(
      { id },
      withHandoffStamp(conversation, data) as QueryDeepPartialEntity<Conversation>,
    );

    const updatedConversation = await this.findById(id);

    // Broadcast conversation updated event
    if (updatedConversation) {
      const { conversationEventsService } = await import("../services/conversation-events.service");
      const changedFields = Object.keys(data);
      await conversationEventsService.broadcastConversationUpdated(
        updatedConversation,
        changedFields,
      );
      this.notifyDevicesOnTransition(conversation.status, updatedConversation);
      await this.recordCloseOnTransition(conversation.status, updatedConversation);
    }

    return updatedConversation;
  }

  /**
   * Get conversations that are available for processing
   * Includes both open conversations and stuck processing conversations (past lock expiry)
   */
  async getAvailableForProcessing(): Promise<Conversation[]> {
    if (!this.getRepository()) {
      logger.error("Repository not initialized");
      return [];
    }

    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      const queryBuilder = this.getRepository().createQueryBuilder("conversation");

      // Only select conversations that are truly available for processing
      queryBuilder
        .where("conversation.deleted_at IS NULL")
        .andWhere(
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
      logger.error({ err: error }, "Error getting available conversations");
      return [];
    }
  }

  /**
   * Find conversations where needs_processing=true but haven't been updated recently.
   * Used by the sweep safety net to re-enqueue conversations that may have been missed.
   */
  async getStaleUnprocessed(thresholdMs: number): Promise<Conversation[]> {
    if (!this.getRepository()) {
      return [];
    }

    try {
      const threshold = new Date(Date.now() - thresholdMs);

      return await this.getRepository()
        .createQueryBuilder("conversation")
        .where("conversation.needs_processing = :needsProcessing", { needsProcessing: true })
        .andWhere("conversation.updated_at < :threshold", { threshold })
        // Simulation runs track their own conversations (D7-7)
        .andWhere(notSimulationSql("conversation"))
        .andWhere("conversation.status IN (:...statuses)", {
          statuses: ["open", "processing"],
        })
        .andWhere(
          "(conversation.processing_locked_until IS NULL OR conversation.processing_locked_until < :now)",
          { now: new Date() },
        )
        .select(["conversation.id", "conversation.organization_id"])
        .getMany();
    } catch (error) {
      logger.error({ err: error }, "Error getting stale unprocessed");
      return [];
    }
  }

  override async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.getRepository().delete({
      id,
      organization_id: organizationId,
    });

    const deleted = result.affected !== 0;

    // Broadcast conversation deleted event
    if (deleted) {
      const { conversationEventsService } = await import("../services/conversation-events.service");
      await conversationEventsService.broadcastConversationDeleted(id, organizationId);
    }

    return deleted;
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
    // Exclude soft-deleted (anonymized) conversations by default
    queryBuilder
      .where("entity.organization_id = :organizationId", {
        organizationId,
      })
      .andWhere("entity.deleted_at IS NULL")
      .andWhere(notSimulationSql("entity"));

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
        case "assignedUser":
          queryBuilder.leftJoinAndSelect("entity.assignedUser", "assignedUser");
          break;
        default:
          // Try to apply generic relation
          try {
            queryBuilder.leftJoinAndSelect(`entity.${relation}`, relation);
          } catch (error) {
            logger.warn({ relation }, "Invalid relation for Conversation entity");
          }
      }
    });
  }

  /**
   * Find the most recent active conversation for a customer on a given channel
   * with the given channel identity. Used by channel plugins (WhatsApp, etc.)
   * to reuse existing conversations instead of creating duplicates.
   *
   * A merged customer can have several identities on one channel (D13-13); a
   * conversation replies to `metadata.customerExternalId`, else the customer's
   * own external_id, so only a conversation that replies to `identity` matches.
   */
  async findActiveByCustomerAndChannel(
    customer: { id: string; external_id: string | null },
    identity: string,
    channel: string,
    organizationId: string,
  ): Promise<Conversation | null> {
    return await this.getRepository()
      .createQueryBuilder("conversation")
      .where("conversation.customer_id = :customerId", { customerId: customer.id })
      .andWhere(
        "COALESCE(conversation.metadata ->> 'customerExternalId', CAST(:ownExternalId AS text)) = :identity",
        { ownExternalId: customer.external_id, identity },
      )
      .andWhere("conversation.channel = :channel", { channel })
      .andWhere("conversation.organization_id = :organizationId", { organizationId })
      .andWhere("conversation.status IN (:...statuses)", {
        statuses: ["open", "processing", "pending-human", "awaiting-approval", "human-took-over"],
      })
      .andWhere("conversation.deleted_at IS NULL")
      .orderBy("conversation.created_at", "DESC")
      .getOne();
  }

  /**
   * Find a conversation by the provider-side conversation id stored in
   * metadata[channel].conversationId. Used by channel plugins to locate the
   * Hay conversation that corresponds to an external event (e.g. a Chatwoot
   * conversation_resolved webhook).
   */
  async findByExternalConversationId(
    channel: string,
    externalConversationId: string,
    organizationId: string,
  ): Promise<Conversation | null> {
    return await this.getRepository()
      .createQueryBuilder("conversation")
      .where("conversation.organization_id = :organizationId", { organizationId })
      .andWhere("conversation.channel = :channel", { channel })
      .andWhere("conversation.metadata -> :channel ->> 'conversationId' = :externalId", {
        channel,
        externalId: externalConversationId,
      })
      .andWhere("conversation.deleted_at IS NULL")
      .orderBy("conversation.created_at", "DESC")
      .getOne();
  }

  async findReadyForProcessing(): Promise<Conversation[]> {
    const query = this.getRepository()
      .createQueryBuilder("conversation")
      .where("conversation.deleted_at IS NULL")
      .andWhere("conversation.needs_processing = :needsProcessing", {
        needsProcessing: true,
      })
      // pending-human only gets needs_processing outside business hours (D5-7);
      // runConversation re-checks the hours before answering.
      .andWhere("conversation.status IN (:...statuses)", {
        statuses: ["open", "processing", "pending-human"],
      })
      .andWhere("(conversation.cooldown_until IS NULL OR conversation.cooldown_until <= :now)", {
        now: new Date(),
      })
      .andWhere(notSimulationSql("conversation"));

    const results = await query.getMany();

    return results;
  }

  /** Open conversations for the inactivity check; simulations never time out (D7-7). */
  async findAllOpenConversations(): Promise<Conversation[]> {
    return await this.getRepository()
      .createQueryBuilder("conversation")
      .where("conversation.status = 'open'")
      .andWhere("conversation.deleted_at IS NULL")
      .andWhere(notSimulationSql("conversation"))
      .orderBy("conversation.created_at", "DESC")
      .getMany();
  }

  async getPublicMessages(conversationId: string): Promise<Message[]> {
    const messageRepository = this.getMessageRepository();
    const { DeliveryState } = await import("@server/types/message-feedback.types");
    return await messageRepository.find({
      where: {
        conversation_id: conversationId,
        type: In([
          MessageType.CUSTOMER,
          MessageType.BOT_AGENT,
          MessageType.HUMAN_AGENT,
          MessageType.PRODUCT_RECOMMENDATION,
        ]),
        deliveryState: DeliveryState.SENT, // Only include approved/sent messages
      },
      order: { created_at: "ASC" },
    });
  }

  /**
   * What the webchat widget shows: the public messages plus the System lines
   * announcing a team member joining or leaving. Kept apart from
   * getPublicMessages, which the orchestrator reads as conversation history.
   */
  async getWidgetMessages(conversationId: string): Promise<Message[]> {
    const { DeliveryState } = await import("@server/types/message-feedback.types");
    return await this.getMessageRepository()
      .createQueryBuilder("message")
      .where("message.conversation_id = :conversationId", { conversationId })
      .andWhere("message.delivery_state = :sent", { sent: DeliveryState.SENT })
      .andWhere(
        new Brackets((qb) => {
          qb.where("message.type IN (:...publicTypes)", {
            publicTypes: [
              MessageType.CUSTOMER,
              MessageType.BOT_AGENT,
              MessageType.HUMAN_AGENT,
              MessageType.PRODUCT_RECOMMENDATION,
            ],
          }).orWhere(
            "(message.type = :systemType AND message.metadata ->> 'systemEvent' IN (:...systemEvents))",
            { systemType: MessageType.SYSTEM, systemEvents: [...AGENT_SYSTEM_EVENTS] },
          );
        }),
      )
      .orderBy("message.created_at", "ASC")
      .getMany();
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

  /**
   * Clear needs_processing for a run that answered up to `lastCustomerMessageId`
   * (null: the run saw no customer message). Compare-and-set: nothing changes
   * when a newer customer message exists, because that message set the flag
   * after the run read its input and still needs an answer. Returns whether
   * the flag was cleared.
   */
  async markProcessed(
    conversationId: string,
    lastCustomerMessageId: string | null,
  ): Promise<boolean> {
    const newerCustomerMessage = lastCustomerMessageId
      ? `m.id <> :lastId AND m.created_at >= (SELECT created_at FROM messages WHERE id = :lastId)`
      : "TRUE";

    const result = await this.getRepository()
      .createQueryBuilder()
      .update(Conversation)
      .set({ needs_processing: false, last_processed_at: () => "NOW()" })
      .where("id = :id", { id: conversationId })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.conversation_id = :id AND m.type = :customer AND ${newerCustomerMessage}
        )`,
        { customer: MessageType.CUSTOMER, lastId: lastCustomerMessageId },
      )
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * True when the newest customer message has no bot or staff reply after it.
   * System notices, tool output and the like are not replies.
   */
  async hasUnansweredCustomerMessage(conversationId: string): Promise<boolean> {
    const [row]: Array<{ unanswered: boolean }> = await AppDataSource.query(
      `SELECT COALESCE(
         (SELECT MAX(created_at) FROM messages WHERE conversation_id = $1 AND type = $2)
           > COALESCE(
             (SELECT MAX(created_at) FROM messages WHERE conversation_id = $1 AND type IN ($3, $4)),
             '-infinity'::timestamptz
           ),
         FALSE
       ) AS unanswered`,
      [conversationId, MessageType.CUSTOMER, MessageType.BOT_AGENT, MessageType.HUMAN_AGENT],
    );
    return row?.unanswered === true;
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
        AND deleted_at IS NULL
        AND ${notSimulationSql("conversations")}
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
      .where("conversation.organization_id = :organizationId", {
        organizationId: filters.organizationId,
      })
      .andWhere("conversation.deleted_at IS NULL")
      .andWhere(notSimulationSql("conversation"));

    if (filters.startDate) {
      queryBuilder.andWhere("conversation.created_at >= :startDate", {
        startDate: filters.startDate,
      });
    }

    if (filters.endDate) {
      queryBuilder.andWhere("conversation.created_at <= :endDate", { endDate: filters.endDate });
    }

    if (filters.status) {
      queryBuilder.andWhere("conversation.status = :status", { status: filters.status });
    }

    return await queryBuilder.getCount();
  }

  /**
   * Resolutions the merchant is billed for: billable close outcomes (D1-3)
   * that were not reversed by the shopper coming back nor excluded by the
   * merchant (D1-6), counted by close time. Reads conversation_outcomes, not the live conversation, so reopening or
   * deleting a conversation does not rewrite a bill.
   */
  async countBillableResolutions(filters: {
    organizationId: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<number> {
    const queryBuilder = AppDataSource.getRepository(ConversationOutcome)
      .createQueryBuilder("outcome")
      .where("outcome.organization_id = :organizationId", {
        organizationId: filters.organizationId,
      })
      .andWhere("outcome.billable = true")
      .andWhere("outcome.reversed_at IS NULL")
      .andWhere("outcome.excluded_at IS NULL");
    if (filters.startDate) {
      queryBuilder.andWhere("outcome.closed_at >= :startDate", { startDate: filters.startDate });
    }
    if (filters.endDate) {
      // End-exclusive like the ledger: billing periods share their boundary
      // instant, so an inclusive end would count that resolution twice.
      queryBuilder.andWhere("outcome.closed_at < :endDate", { endDate: filters.endDate });
    }
    return await queryBuilder.getCount();
  }

  /**
   * Atomically acquire a processing lock on a conversation.
   * Returns a unique lockerId on success, null if already locked.
   * The lockerId must be passed to refreshLock / releaseLock to prove ownership.
   */
  async acquireLock(conversationId: string, organizationId: string): Promise<string | null> {
    const lockerId = uuidv4();
    const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
    const now = new Date();

    const result = await this.getRepository()
      .createQueryBuilder()
      .update(Conversation)
      .set({
        processing_locked_until: lockUntil,
        processing_locked_by: lockerId,
      })
      .where("id = :id", { id: conversationId })
      .andWhere("organization_id = :organizationId", { organizationId })
      .andWhere("(processing_locked_until IS NULL OR processing_locked_until < :now)", { now })
      .execute();

    return (result.affected ?? 0) > 0 ? lockerId : null;
  }

  /**
   * Extend an existing lock's expiry. Only succeeds if the caller owns the lock
   * (i.e. processing_locked_by matches the lockerId returned by acquireLock).
   * Returns false if the lock was stolen or already released — caller should abort.
   */
  async refreshLock(conversationId: string, lockerId: string): Promise<boolean> {
    const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);

    const result = await this.getRepository()
      .createQueryBuilder()
      .update(Conversation)
      .set({ processing_locked_until: lockUntil })
      .where("id = :id", { id: conversationId })
      .andWhere("processing_locked_by = :lockerId", { lockerId })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Release a lock — only clears it if we still own it.
   * Silent no-op if the lock has been taken over by another worker.
   */
  async releaseLock(conversationId: string, lockerId: string): Promise<void> {
    await this.getRepository()
      .createQueryBuilder()
      .update(Conversation)
      .set({ processing_locked_until: null, processing_locked_by: null })
      .where("id = :id", { id: conversationId })
      .andWhere("processing_locked_by = :lockerId", { lockerId })
      .execute();
  }
}

export const conversationRepository = new ConversationRepository();
