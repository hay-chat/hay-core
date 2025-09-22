import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";
import type { DeepPartial } from "typeorm";

class OrganizationService {
  private repository = AppDataSource.getRepository(Organization);

  async findOne(id: string): Promise<Organization | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return this.repository.findOne({ where: { slug } });
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