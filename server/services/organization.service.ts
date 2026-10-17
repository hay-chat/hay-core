import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";
import type { DeepPartial, QueryDeepPartialEntity } from "typeorm";
import { StorageService } from "./storage.service";
import { vectorStoreService } from "./vector-store.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("organization-service");

class OrganizationService {
  private repository = AppDataSource.getRepository(Organization);
  private storageService = new StorageService();

  async findOne(id: string): Promise<Organization | null> {
    return this.repository.findOne({
      where: { id },
      relations: ["logoUpload"],
    });
  }

  async findOneWithUrls(id: string): Promise<(Organization & { logoUrl?: string }) | null> {
    const org = await this.findOne(id);
    if (!org) return null;

    const result: Organization & { logoUrl?: string } = org;

    if (org.logoUpload) {
      result.logoUrl = this.storageService.getPublicUrl(org.logoUpload);
    }

    return result;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return this.repository.findOne({ where: { slug } });
  }

  /**
   * Generate a unique slug from organization name
   * If slug already exists, append a random 3-character suffix
   */
  async generateUniqueSlug(name: string): Promise<string> {
    // Base slug generation
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

    // Check if base slug is available
    const existingOrg = await this.findBySlug(baseSlug);
    if (!existingOrg) {
      return baseSlug;
    }

    // Generate random suffix and retry
    const generateRandomSuffix = () => {
      const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
      let suffix = "";
      for (let i = 0; i < 3; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return suffix;
    };

    // Try up to 10 times to find a unique slug
    for (let attempt = 0; attempt < 10; attempt++) {
      const suffix = generateRandomSuffix();
      const uniqueSlug = `${baseSlug}-${suffix}`;
      const conflictingOrg = await this.findBySlug(uniqueSlug);
      if (!conflictingOrg) {
        return uniqueSlug;
      }
    }

    // Fallback to timestamp-based suffix if all random attempts fail
    return `${baseSlug}-${Date.now().toString(36)}`;
  }

  async create(data: DeepPartial<Organization>): Promise<Organization> {
    const organization = this.repository.create(data);
    return this.repository.save(organization);
  }

  async update(id: string, data: DeepPartial<Organization>): Promise<Organization> {
    await this.repository.update(id, data as QueryDeepPartialEntity<Organization>);
    const updated = await this.findOne(id);
    if (!updated) {
      throw new Error("Organization not found after update");
    }
    return updated;
  }

  /**
   * Delete an organization and every piece of data that belongs to it.
   * Shared by the owner-facing `organizations.delete` procedure and the
   * operator-facing `internal.organizations.delete`.
   */
  async deleteWithData(organization: Organization): Promise<void> {
    const orgId = organization.id;

    // Use transaction to ensure all related data is deleted
    await AppDataSource.transaction(async (manager) => {
      // Delete organization logo from storage if exists
      if (organization.logoUploadId) {
        try {
          await this.storageService.delete(organization.logoUploadId);
        } catch (error) {
          logger.error({ err: error, orgId }, "Failed to delete organization logo");
          // Continue with deletion even if logo deletion fails
        }
      }

      // Delete embeddings from vector store within the transaction
      await vectorStoreService.deleteByOrganizationId(orgId, manager);

      // Product embeddings live in a separate table (product_embeddings) and
      // are NOT FK-cascaded onto organizations through the entity layer, so
      // delete them explicitly here in the same transaction.
      const { productVectorStoreService } =
        await import("@server/services/product-vector-store.service");
      await productVectorStoreService.deleteByOrganizationId(orgId, manager);

      // Delete organization - CASCADE will handle most related entities:
      // - Agents (onDelete: CASCADE)
      // - Conversations (onDelete: CASCADE) -> Messages (onDelete: CASCADE)
      // - Documents (onDelete: CASCADE) -> Embeddings (onDelete: CASCADE)
      // - Customers (onDelete: CASCADE)
      // - Playbooks (onDelete: CASCADE)
      // - Sources (onDelete: CASCADE)
      // - WebchatSettings (onDelete: CASCADE)
      // - UserOrganizations (onDelete: CASCADE)
      // - OrganizationInvitations (onDelete: CASCADE)
      // - ApiKeys (onDelete: CASCADE)
      // - Jobs (onDelete: CASCADE)
      // - Uploads (onDelete: CASCADE)
      // - PluginInstances (onDelete: CASCADE)
      // - ScheduledJobs (onDelete: CASCADE)
      // - AuditLogs (onDelete: CASCADE)
      // - PrivacyRequests (onDelete: CASCADE)
      // - Products / ProductVariants (onDelete: CASCADE; product_embeddings
      //   handled above because it's a raw-SQL table without an entity FK)
      await manager.getRepository(Organization).delete({ id: orgId });
    });

    // Note: Can't log to audit_logs since the org is deleted
    // TODO: Log to external audit service for compliance tracking
    logger.info({ orgName: organization.name, orgId }, "Organization deleted");
  }

  async list(options?: {
    limit?: number;
    offset?: number;
    isActive?: boolean;
  }): Promise<[Organization[], number]> {
    const query = this.repository.createQueryBuilder("organization");

    if (options?.isActive !== undefined) {
      query.andWhere("organization.isActive = :isActive", {
        isActive: options.isActive,
      });
    }

    if (options?.limit) {
      query.limit(options.limit);
    }

    if (options?.offset) {
      query.offset(options.offset);
    }

    return query.getManyAndCount();
  }
}

export const organizationService = new OrganizationService();
