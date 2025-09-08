import { Repository, SelectQueryBuilder } from "typeorm";
import { Customer } from "../database/entities/customer.entity";
import { AppDataSource } from "../database/data-source";
import { BaseRepository } from "./base.repository";

export class CustomerRepository extends BaseRepository<Customer> {
  private legacyRepository!: Repository<Customer>;

  constructor() {
    super(Customer);
  }

  private getLegacyRepository(): Repository<Customer> {
    if (!this.legacyRepository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(`Database not initialized. Cannot access Customer repository.`);
      }
      this.legacyRepository = AppDataSource.getRepository(Customer);
    }
    return this.legacyRepository;
  }

  /**
   * Override base methods to handle snake_case field naming
   */
  override async create(data: Partial<Customer>): Promise<Customer> {
    const customer = this.getLegacyRepository().create(data);
    return await this.getLegacyRepository().save(customer);
  }

  override async findById(id: string): Promise<Customer | null> {
    return await this.getLegacyRepository().findOne({
      where: { id },
      relations: ["conversations"],
    });
  }

  async findByExternalId(
    externalId: string,
    organizationId: string
  ): Promise<Customer | null> {
    return await this.getLegacyRepository().findOne({
      where: { external_id: externalId, organization_id: organizationId },
    });
  }

  async findByEmail(
    email: string,
    organizationId: string
  ): Promise<Customer | null> {
    return await this.getLegacyRepository().findOne({
      where: { email, organization_id: organizationId },
    });
  }

  override async findByOrganization(
    organizationId: string
  ): Promise<Customer[]> {
    return await this.getLegacyRepository().find({
      where: { organization_id: organizationId },
      order: { created_at: "DESC" },
    });
  }

  override async update(
    id: string,
    organizationId: string,
    data: Partial<Customer>
  ): Promise<Customer | null> {
    const customer = await this.findById(id);
    if (!customer || customer.organization_id !== organizationId) {
      return null;
    }

    await this.getLegacyRepository().update(
      { id, organization_id: organizationId },
      data
    );

    return await this.findById(id);
  }

  override async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.getLegacyRepository().delete({
      id,
      organization_id: organizationId,
    });

    return result.affected !== 0;
  }

  /**
   * Override pagination method to handle snake_case field naming
   */
  override async paginateQuery(
    listParams: any,
    organizationId: string,
    baseWhere?: Record<string, any>
  ) {
    const queryBuilder = this.getLegacyRepository().createQueryBuilder("entity");

    // Use organization_id instead of organizationId
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

    // Apply customer-specific filters
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
   * Apply customer-specific filters
   */
  protected override applyFilters(
    queryBuilder: SelectQueryBuilder<Customer>,
    filters?: Record<string, any>,
    _organizationId?: string
  ): void {
    if (!filters) return;

    if (filters.email) {
      queryBuilder.andWhere("entity.email = :email", {
        email: filters.email,
      });
    }

    if (filters.externalId) {
      queryBuilder.andWhere("entity.external_id = :externalId", {
        externalId: filters.externalId,
      });
    }

    if (filters.hasConversations !== undefined) {
      if (filters.hasConversations) {
        queryBuilder.andWhere(
          "EXISTS (SELECT 1 FROM conversations WHERE conversations.customer_id = entity.id)"
        );
      } else {
        queryBuilder.andWhere(
          "NOT EXISTS (SELECT 1 FROM conversations WHERE conversations.customer_id = entity.id)"
        );
      }
    }
  }

  /**
   * Apply customer-specific search functionality
   */
  protected override applySearch(
    queryBuilder: SelectQueryBuilder<Customer>,
    search?: { query?: string; searchFields?: string[] }
  ): void {
    if (!search?.query) return;

    // Default search fields for customers
    const searchFields = search.searchFields || ["name", "email", "external_id"];

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
   * Apply customer-specific includes/relations
   */
  protected override applyIncludes(
    queryBuilder: SelectQueryBuilder<Customer>,
    include?: string[]
  ): void {
    if (!include || include.length === 0) return;

    include.forEach((relation) => {
      switch (relation) {
        case "conversations":
          queryBuilder.leftJoinAndSelect("entity.conversations", "conversations");
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
              `Invalid relation '${relation}' for Customer entity`
            );
          }
      }
    });
  }

  /**
   * Merge two customers together
   * Transfers all conversations from the source customer to the target customer
   */
  async mergeCustomers(
    sourceCustomerId: string,
    targetCustomerId: string,
    organizationId: string
  ): Promise<Customer | null> {
    const sourceCustomer = await this.findById(sourceCustomerId);
    const targetCustomer = await this.findById(targetCustomerId);

    if (!sourceCustomer || !targetCustomer || 
        sourceCustomer.organization_id !== organizationId || 
        targetCustomer.organization_id !== organizationId) {
      return null;
    }

    // Update all conversations to point to the target customer
    await this.getLegacyRepository().query(
      `UPDATE conversations SET customer_id = $1 WHERE customer_id = $2 AND organization_id = $3`,
      [targetCustomerId, sourceCustomerId, organizationId]
    );

    // Merge metadata if both have it
    if (sourceCustomer.external_metadata && targetCustomer.external_metadata) {
      const mergedMetadata = {
        ...sourceCustomer.external_metadata,
        ...targetCustomer.external_metadata,
        _merged_from: sourceCustomerId,
        _merged_at: new Date().toISOString(),
      };
      
      await this.update(targetCustomerId, organizationId, {
        external_metadata: mergedMetadata,
      });
    }

    // Delete the source customer
    await this.delete(sourceCustomerId, organizationId);

    return await this.findById(targetCustomerId);
  }
}