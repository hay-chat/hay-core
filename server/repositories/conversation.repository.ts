import { Repository, SelectQueryBuilder } from "typeorm";
import { Conversation } from "../database/entities/conversation.entity";
import { AppDataSource } from "../database/data-source";
import { BaseRepository } from "./base.repository";

export class ConversationRepository extends BaseRepository<Conversation> {
  private legacyRepository: Repository<Conversation>;

  constructor() {
    super(Conversation);
    this.legacyRepository = AppDataSource.getRepository(Conversation);
  }

  /**
   * Override base methods to handle organization_id field naming
   */
  override async create(data: Partial<Conversation>): Promise<Conversation> {
    const conversation = this.legacyRepository.create(data);
    return await this.legacyRepository.save(conversation);
  }

  override async findById(id: string): Promise<Conversation | null> {
    return await this.legacyRepository.findOne({
      where: { id },
      relations: ["messages"],
    });
  }

  async findByAgent(
    agentId: string,
    organizationId: string
  ): Promise<Conversation[]> {
    return await this.legacyRepository.find({
      where: { agent_id: agentId, organization_id: organizationId },
      order: { created_at: "DESC" },
    });
  }

  override async findByOrganization(
    organizationId: string
  ): Promise<Conversation[]> {
    return await this.legacyRepository.find({
      where: { organization_id: organizationId },
      order: { created_at: "DESC" },
    });
  }

  override async update(
    id: string,
    data: Partial<Conversation>
  ): Promise<Conversation | null> {
    const conversation = await this.findById(id);
    if (!conversation) {
      return null;
    }

    await this.legacyRepository.update({ id }, data);

    return await this.findById(id);
  }

  override async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.legacyRepository.delete({
      id,
      organization_id: organizationId,
    });

    return result.affected !== 0;
  }

  /**
   * Override pagination method to handle organization_id field naming
   */
  override async paginateQuery(
    listParams: any,
    organizationId: string,
    baseWhere?: Record<string, any>
  ) {
    const queryBuilder = this.legacyRepository.createQueryBuilder("entity");

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
    queryBuilder
      .skip(listParams.pagination.offset)
      .take(listParams.pagination.limit);

    // Apply select fields if specified
    if (listParams.select && listParams.select.length > 0) {
      const selectFields = listParams.select.map(
        (field: string) => `entity.${field}`
      );
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
        hasNext:
          listParams.pagination.page <
          Math.ceil(total / listParams.pagination.limit),
        hasPrev: listParams.pagination.page > 1,
      },
    };
  }

  /**
   * Apply conversation-specific filters
   */
  protected override applyFilters(
    queryBuilder: SelectQueryBuilder<Conversation>,
    filters?: Record<string, any>,
    organizationId?: string
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
          "EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = entity.id)"
        );
      } else {
        queryBuilder.andWhere(
          "NOT EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = entity.id)"
        );
      }
    }
  }

  /**
   * Apply conversation-specific search functionality
   */
  protected override applySearch(
    queryBuilder: SelectQueryBuilder<Conversation>,
    search?: { query?: string; searchFields?: string[] }
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
        searchFields.reduce((params, _, index) => {
          params[`searchQuery${index}`] = `%${search.query}%`;
          return params;
        }, {} as Record<string, any>)
      );
    }
  }

  /**
   * Apply conversation-specific includes/relations
   */
  protected override applyIncludes(
    queryBuilder: SelectQueryBuilder<Conversation>,
    include?: string[]
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
            console.warn(
              `Invalid relation '${relation}' for Conversation entity`
            );
          }
      }
    });
  }

  async findReadyForProcessing(): Promise<Conversation[]> {
    const query = this.repository
      .createQueryBuilder("conversation")
      .where("conversation.needs_processing = :needsProcessing", {
        needsProcessing: true,
      })
      .andWhere("conversation.status IN (:...statuses)", {
        statuses: ["open", "processing"],
      })
      .andWhere(
        "(conversation.cooldown_until IS NULL OR conversation.cooldown_until <= :now)",
        { now: new Date() }
      );

    const results = await query.getMany();

    return results;
  }

  async findAllOpenConversations(): Promise<Conversation[]> {
    return await this.repository.find({
      where: { status: "open" },
      order: { created_at: "DESC" },
    });
  }
}

export const conversationRepository = new ConversationRepository();
