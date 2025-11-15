import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";
import type { DeepPartial } from "typeorm";
import { StorageService } from "./storage.service";

class OrganizationService {
  private repository = AppDataSource.getRepository(Organization);
  private storageService = new StorageService();

  async findOne(id: string): Promise<Organization | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findOneWithUrls(id: string): Promise<Organization & { logoUrl?: string } | null> {
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
    await this.repository.update(id, data as any);
    const updated = await this.findOne(id);
    if (!updated) {
      throw new Error("Organization not found after update");
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
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