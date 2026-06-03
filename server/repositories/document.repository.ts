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
   * Get document counts grouped by status for an organization
   */
  async getStatusCounts(organizationId: string): Promise<Array<{ status: string; count: number }>> {
    const results = await this.getRepository()
      .createQueryBuilder("doc")
      .select("doc.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("doc.organization_id = :organizationId", { organizationId })
      .groupBy("doc.status")
      .orderBy("count", "DESC")
      .getRawMany();

    return results.map((row: { status: string; count: string }) => ({
      status: row.status,
      count: parseInt(row.count, 10),
    }));
  }

  /**
   * Find a document by its source URL within an organization.
   * Used for deduplication during web imports.
   */
  async findBySourceUrl(sourceUrl: string, organizationId: string): Promise<Document | null> {
    return await this.getRepository().findOne({
      where: { sourceUrl, organizationId },
    });
  }

  /**
   * Find a document by its external id within a document source.
   * Used by the sync engine to look up existing documents.
   */
  async findByExternalId(documentSourceId: string, externalId: string): Promise<Document | null> {
    return await this.getRepository().findOne({
      where: { documentSourceId, externalId },
    });
  }

  /**
   * Find all documents belonging to a document source, with optional pagination.
   */
  async findByDocumentSourceId(
    documentSourceId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Document[]> {
    return await this.getRepository().find({
      where: { documentSourceId },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  async countByDocumentSourceId(documentSourceId: string): Promise<number> {
    return await this.getRepository().count({
      where: { documentSourceId },
    });
  }

  /**
   * Return only the external ids of documents in a document source.
   * Cheap projection used by the deletion-detection full sweep; may return
   * thousands of rows.
   */
  async findExternalIdsForSource(documentSourceId: string): Promise<string[]> {
    const results = await this.getRepository()
      .createQueryBuilder("entity")
      .select("entity.external_id", "externalId")
      .where("entity.document_source_id = :documentSourceId", { documentSourceId })
      .getRawMany();

    return results
      .map((row: { externalId: string | null }) => row.externalId)
      .filter((externalId): externalId is string => externalId !== null);
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
