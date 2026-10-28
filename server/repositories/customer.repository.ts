import { In, Repository, SelectQueryBuilder } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm";
import { Customer } from "../database/entities/customer.entity";
import { AppDataSource } from "../database/data-source";
import { BaseRepository } from "./base.repository";
import type { ListParams } from "../trpc/middleware/pagination";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("customer-repo");

/** external_metadata key listing the channel identities a customer took over in merges. */
export const MERGED_EXTERNAL_IDS_KEY = "_mergedExternalIds";

function mergedExternalIds(customer: Customer): string[] {
  const ids = customer.external_metadata?.[MERGED_EXTERNAL_IDS_KEY];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** One suggested merge: `duplicateId` looks like the same person as `customerId`. */
export interface MergeSuggestionRow {
  customerId: string;
  duplicateId: string;
  reason: "email" | "phone";
  value: string;
}

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

  /**
   * @deprecated Use findByIdAndOrganization instead to ensure proper organization scoping
   */
  override async findById(id: string): Promise<Customer | null> {
    return await this.getLegacyRepository().findOne({
      where: { id },
      relations: ["conversations"],
    });
  }

  /**
   * Find customer by ID and organizationId - ensures proper organization scoping
   */
  override async findByIdAndOrganization(
    id: string,
    organizationId: string,
  ): Promise<Customer | null> {
    return await this.getLegacyRepository().findOne({
      where: { id, organization_id: organizationId },
      relations: ["conversations"],
    });
  }

  /**
   * The customer for a channel identity: its own external_id, or one it took
   * over in a merge (D13-13), so the merged customer keeps receiving that
   * channel's messages.
   */
  async findByExternalId(externalId: string, organizationId: string): Promise<Customer | null> {
    const own = await this.getLegacyRepository().findOne({
      where: { external_id: externalId, organization_id: organizationId },
    });
    if (own) return own;
    return await this.getLegacyRepository()
      .createQueryBuilder("customer")
      .where("customer.organization_id = :organizationId", { organizationId })
      .andWhere(`customer.external_metadata -> '${MERGED_EXTERNAL_IDS_KEY}' ? :externalId`, {
        externalId,
      })
      .orderBy("customer.created_at", "ASC")
      .getOne();
  }

  async findByEmail(email: string, organizationId: string): Promise<Customer | null> {
    return await this.getLegacyRepository().findOne({
      where: { email, organization_id: organizationId },
    });
  }

  override async findByOrganization(organizationId: string): Promise<Customer[]> {
    return await this.getLegacyRepository().find({
      where: { organization_id: organizationId },
      order: { created_at: "DESC" },
    });
  }

  override async update(
    id: string,
    organizationId: string,
    data: Partial<Customer>,
  ): Promise<Customer | null> {
    const customer = await this.findById(id);
    if (!customer || customer.organization_id !== organizationId) {
      return null;
    }

    await this.getLegacyRepository().update(
      { id, organization_id: organizationId },
      data as QueryDeepPartialEntity<Customer>,
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
    listParams: ListParams,
    organizationId: string,
    baseWhere?: Record<string, unknown>,
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
   * Apply customer-specific filters
   */
  protected override applyFilters(
    queryBuilder: SelectQueryBuilder<Customer>,
    filters?: Record<string, unknown>,
    _organizationId?: string,
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
          "EXISTS (SELECT 1 FROM conversations WHERE conversations.customer_id = entity.id)",
        );
      } else {
        queryBuilder.andWhere(
          "NOT EXISTS (SELECT 1 FROM conversations WHERE conversations.customer_id = entity.id)",
        );
      }
    }
  }

  /**
   * Apply customer-specific search functionality
   */
  protected override applySearch(
    queryBuilder: SelectQueryBuilder<Customer>,
    search?: { query?: string; searchFields?: string[] },
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
        searchFields.reduce(
          (params, _, index) => {
            params[`searchQuery${index}`] = `%${search.query}%`;
            return params;
          },
          {} as Record<string, unknown>,
        ),
      );
    }
  }

  /**
   * Apply customer-specific includes/relations
   */
  protected override applyIncludes(
    queryBuilder: SelectQueryBuilder<Customer>,
    include?: string[],
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
            logger.warn({ relation }, "Invalid relation for Customer entity");
          }
      }
    });
  }

  /**
   * Merge the source customer into the target and delete the source.
   *
   * Channel replies route on the customer's external_id, so the source's
   * identity is kept (D13-13):
   *   - its conversations record it as `metadata.customerExternalId`, which
   *     channel delivery prefers, so replies still reach the shopper there;
   *   - the target lists it under `_mergedExternalIds`, so the next message
   *     from that identity finds the target instead of creating a duplicate.
   * Blank name/email/phone on the target are filled from the source.
   */
  async mergeCustomers(
    sourceCustomerId: string,
    targetCustomerId: string,
    organizationId: string,
  ): Promise<Customer | null> {
    if (sourceCustomerId === targetCustomerId) return null;
    const sourceCustomer = await this.findById(sourceCustomerId);
    const targetCustomer = await this.findById(targetCustomerId);

    if (
      !sourceCustomer ||
      !targetCustomer ||
      sourceCustomer.organization_id !== organizationId ||
      targetCustomer.organization_id !== organizationId
    ) {
      return null;
    }

    const aliases = Array.from(
      new Set([
        ...mergedExternalIds(targetCustomer),
        ...(sourceCustomer.external_id ? [sourceCustomer.external_id] : []),
        ...mergedExternalIds(sourceCustomer),
      ]),
    ).filter((id) => id !== targetCustomer.external_id);

    await AppDataSource.transaction(async (manager) => {
      if (sourceCustomer.external_id) {
        await manager.query(
          `UPDATE conversations
              SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('customerExternalId', $1::text)
            WHERE customer_id = $2 AND organization_id = $3
              AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'customerExternalId')`,
          [sourceCustomer.external_id, sourceCustomerId, organizationId],
        );
      }
      await manager.query(
        `UPDATE conversations SET customer_id = $1 WHERE customer_id = $2 AND organization_id = $3`,
        [targetCustomerId, sourceCustomerId, organizationId],
      );
      // Files the shopper sent stay findable for retention and erasure (D8-3).
      await manager.query(
        `UPDATE uploads SET customer_id = $1 WHERE customer_id = $2 AND organization_id = $3`,
        [targetCustomerId, sourceCustomerId, organizationId],
      );

      const externalMetadata: Record<string, unknown> = {
        ...(sourceCustomer.external_metadata ?? {}),
        ...(targetCustomer.external_metadata ?? {}),
        _merged_from: sourceCustomerId,
        _merged_at: new Date().toISOString(),
      };
      if (aliases.length) externalMetadata[MERGED_EXTERNAL_IDS_KEY] = aliases;

      await manager.update(
        Customer,
        { id: targetCustomerId, organization_id: organizationId },
        {
          external_metadata:
            externalMetadata as QueryDeepPartialEntity<Customer>["external_metadata"],
          name: targetCustomer.name || sourceCustomer.name,
          email: targetCustomer.email || sourceCustomer.email,
          phone: targetCustomer.phone || sourceCustomer.phone,
        },
      );
      await manager.delete(Customer, { id: sourceCustomerId, organization_id: organizationId });
    });

    return await this.findById(targetCustomerId);
  }

  /**
   * Customers that look like the same person (D13-13): the same email, or the
   * same phone number, on two customer records (typically two channels). The
   * email-channel and WhatsApp identities count as email and phone. Pairs a
   * person dismissed are left out. The older customer is first in each pair.
   */
  async findMergeSuggestions(organizationId: string, limit = 20): Promise<MergeSuggestionRow[]> {
    return await this.getLegacyRepository().query(
      `WITH keys AS (
         SELECT id, created_at,
                NULLIF(LOWER(TRIM(COALESCE(NULLIF(email, ''),
                  CASE WHEN external_id ~ '^[^@[:space:]:]+@[^@[:space:]]+$' THEN external_id END))), '') AS email_key,
                NULLIF(REGEXP_REPLACE(COALESCE(NULLIF(phone, ''),
                  CASE WHEN external_id ~ '^[+][0-9]{8,15}$' THEN external_id END), '[^0-9]', '', 'g'), '') AS phone_key
           FROM customers
          WHERE organization_id = $1
       )
       SELECT a.id AS "customerId", b.id AS "duplicateId",
              CASE WHEN a.email_key = b.email_key THEN 'email' ELSE 'phone' END AS "reason",
              CASE WHEN a.email_key = b.email_key THEN a.email_key ELSE a.phone_key END AS "value"
         FROM keys a
         JOIN keys b
           ON (a.created_at, a.id) < (b.created_at, b.id)
          AND (a.email_key = b.email_key OR (LENGTH(a.phone_key) >= 8 AND a.phone_key = b.phone_key))
        WHERE NOT EXISTS (
          SELECT 1 FROM customer_merge_dismissals d
           WHERE d.customer_a_id = LEAST(a.id, b.id) AND d.customer_b_id = GREATEST(a.id, b.id)
        )
        ORDER BY b.created_at DESC
        LIMIT $2`,
      [organizationId, limit],
    );
  }

  /** Customers by id within one organization (no relations). */
  async findManyInOrganization(ids: string[], organizationId: string): Promise<Customer[]> {
    if (!ids.length) return [];
    return await this.getLegacyRepository().find({
      where: { id: In(ids), organization_id: organizationId },
    });
  }

  /** Mark two customers as "not the same person", hiding the suggestion. */
  async dismissMergeSuggestion(
    organizationId: string,
    customerId: string,
    otherCustomerId: string,
  ): Promise<void> {
    const [a, b] = [customerId, otherCustomerId].sort();
    await this.getLegacyRepository().query(
      `INSERT INTO customer_merge_dismissals (organization_id, customer_a_id, customer_b_id)
       SELECT $1, $2, $3
        WHERE (SELECT COUNT(*) FROM customers WHERE id IN ($2, $3) AND organization_id = $1) = 2
       ON CONFLICT (customer_a_id, customer_b_id) DO NOTHING`,
      [organizationId, a, b],
    );
  }
}
