import { Document } from "../entities/document.entity";
import { BaseRepository } from "./base.repository";
import { SelectQueryBuilder } from "typeorm";

export class DocumentRepository extends BaseRepository<Document> {
  constructor() {
    super(Document);
  }

  /**
   * Apply document-specific filters
   */
  protected override applyFilters(
    queryBuilder: SelectQueryBuilder<Document>,
    filters?: Record<string, unknown>,
    organizationId?: string,
  ): void {
    if (!filters) return;

    // Apply document-specific filters
    if (filters.type) {
      queryBuilder.andWhere("entity.type = :type", { type: filters.type });
    }

    if (filters.status) {
      queryBuilder.andWhere("entity.status = :status", {
        status: filters.status,
      });
    }

    if (filters.visibility) {
      queryBuilder.andWhere("entity.visibility = :visibility", {
        visibility: filters.visibility,
      });
    }

    if (filters.agentId) {
      queryBuilder.andWhere("entity.agentId = :agentId", {
        agentId: filters.agentId,
      });
    }

    if (filters.playbookId) {
      queryBuilder.andWhere("entity.playbookId = :playbookId", {
        playbookId: filters.playbookId,
      });
    }

    // Apply any other generic filters
    super.applyFilters(queryBuilder, filters, organizationId);
  }

  /**
   * Apply document-specific search functionality
   */
  protected override applySearch(
    queryBuilder: SelectQueryBuilder<Document>,
    search?: { query?: string; searchFields?: string[] },
  ): void {
    if (!search?.query) return;

    // Default search fields for documents
    const searchFields = search.searchFields || ["title", "content"];

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
   * Apply document-specific includes/relations
   */
  protected override applyIncludes(
    queryBuilder: SelectQueryBuilder<Document>,
    include?: string[],
  ): void {
    if (!include || include.length === 0) return;

    include.forEach((relation) => {
      switch (relation) {
        case "organization":
          queryBuilder.leftJoinAndSelect("entity.organization", "organization");
          break;
        default:
          // Try to apply generic relation
          super.applyIncludes(queryBuilder, [relation]);
      }
    });
  }
}

export const documentRepository = new DocumentRepository();
