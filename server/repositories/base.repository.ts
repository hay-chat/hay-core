import { Repository, SelectQueryBuilder } from "typeorm";
import type { FindManyOptions, ObjectLiteral } from "typeorm";
import { AppDataSource } from "../database/data-source";
import type { ListParams } from "../trpc/middleware/pagination";
import type { PaginatedResponse } from "../types/list-input";
import { createPaginatedResponse } from "../types/list-input";

export abstract class BaseRepository<T extends ObjectLiteral> {
  protected repository: Repository<T>;
  protected entityClass: new () => T;

  constructor(entityClass: new () => T) {
    this.entityClass = entityClass;
    this.repository = AppDataSource.getRepository(entityClass);
  }

  /**
   * Create a paginated query with all the filtering, searching, and sorting options
   */
  async paginateQuery(
    listParams: ListParams,
    organizationId: string,
    baseWhere?: Record<string, any>
  ): Promise<PaginatedResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder("entity");

    // Base organization filter
    queryBuilder.where("entity.organizationId = :organizationId", {
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

    // Apply entity-specific filters
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
      const selectFields = listParams.select.map((field) => `entity.${field}`);
      queryBuilder.select(selectFields);
    }

    // Execute query
    const items = await queryBuilder.getMany();

    return createPaginatedResponse(
      items,
      listParams.pagination.page,
      listParams.pagination.limit,
      total
    );
  }

  /**
   * Apply entity-specific filters - should be overridden by child classes
   */
  protected applyFilters(
    queryBuilder: SelectQueryBuilder<T>,
    filters?: Record<string, any>,
    organizationId?: string
  ): void {
    // Base implementation - override in child classes for entity-specific filters
    if (!filters) return;

    Object.entries(filters).forEach(([key, value], index) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          queryBuilder.andWhere(`entity.${key} IN (:...filter${index})`, {
            [`filter${index}`]: value,
          });
        } else {
          queryBuilder.andWhere(`entity.${key} = :filter${index}`, {
            [`filter${index}`]: value,
          });
        }
      }
    });
  }

  /**
   * Apply search functionality - should be overridden by child classes for better search
   */
  protected applySearch(
    queryBuilder: SelectQueryBuilder<T>,
    search?: { query?: string; searchFields?: string[] }
  ): void {
    if (
      !search?.query ||
      !search.searchFields ||
      search.searchFields.length === 0
    ) {
      return;
    }

    const searchConditions = search.searchFields
      .map((field, index) => `entity.${field} ILIKE :searchQuery${index}`)
      .join(" OR ");

    if (searchConditions) {
      queryBuilder.andWhere(
        `(${searchConditions})`,
        search.searchFields.reduce((params, _, index) => {
          params[`searchQuery${index}`] = `%${search.query}%`;
          return params;
        }, {} as Record<string, any>)
      );
    }
  }

  /**
   * Apply date range filtering
   */
  protected applyDateRange(
    queryBuilder: SelectQueryBuilder<T>,
    dateRange?: { from?: string; to?: string }
  ): void {
    if (!dateRange) return;

    if (dateRange.from) {
      queryBuilder.andWhere("entity.created_at >= :fromDate", {
        fromDate: new Date(dateRange.from),
      });
    }

    if (dateRange.to) {
      queryBuilder.andWhere("entity.created_at <= :toDate", {
        toDate: new Date(dateRange.to),
      });
    }
  }

  /**
   * Apply sorting
   */
  protected applySorting(
    queryBuilder: SelectQueryBuilder<T>,
    sorting: { orderBy?: string; orderDirection: "asc" | "desc" }
  ): void {
    // Default to created_at if no orderBy specified
    const orderBy = sorting.orderBy || "created_at";
    const direction = sorting.orderDirection.toUpperCase() as "ASC" | "DESC";

    queryBuilder.orderBy(`entity.${orderBy}`, direction);
  }

  /**
   * Apply includes/relations - should be overridden by child classes
   */
  protected applyIncludes(
    queryBuilder: SelectQueryBuilder<T>,
    include?: string[]
  ): void {
    if (!include || include.length === 0) return;

    // Base implementation - child classes should override for specific relations
    include.forEach((relation) => {
      try {
        queryBuilder.leftJoinAndSelect(`entity.${relation}`, relation);
      } catch (error) {
        // Silently ignore invalid relations
        console.warn(
          `Invalid relation '${relation}' for entity ${this.entityClass.name}`
        );
      }
    });
  }

  /**
   * Standard CRUD operations
   */
  async create(data: Partial<T>): Promise<T> {
    const entity = this.repository.create(data as any);
    return await this.repository.save(entity as any);
  }

  async findById(id: string, organizationId: string): Promise<T | null> {
    return await this.repository.findOne({
      where: { id, organizationId } as any,
    });
  }

  async update(
    id: string,
    organizationId: string,
    data: Partial<T>
  ): Promise<T | null> {
    const result = await this.repository.update(
      { id, organizationId } as any,
      data
    );

    if (result.affected === 0) {
      return null;
    }

    return await this.findById(id, organizationId);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.repository.delete({
      id,
      organizationId,
    } as any);

    return result.affected !== 0;
  }

  /**
   * Find all entities for an organization (without pagination)
   */
  async findByOrganization(
    organizationId: string,
    options?: FindManyOptions<T>
  ): Promise<T[]> {
    return await this.repository.find({
      where: { organizationId } as any,
      ...options,
    });
  }
}
