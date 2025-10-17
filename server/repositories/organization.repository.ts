import { Repository } from "typeorm";
import { Organization } from "../entities/organization.entity";
import { AppDataSource } from "../database/data-source";

export class OrganizationRepository {
  private repository!: Repository<Organization>;

  constructor() {
    // Lazy initialization
  }

  private getRepository(): Repository<Organization> {
    if (!this.repository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(`Database not initialized. Cannot access Organization repository.`);
      }
      this.repository = AppDataSource.getRepository(Organization);
    }
    return this.repository;
  }

  async findById(id: string): Promise<Organization | null> {
    return await this.getRepository().findOne({
      where: { id },
    });
  }

  async update(id: string, data: Partial<Organization>): Promise<Organization | null> {
    const organization = await this.findById(id);
    if (!organization) {
      return null;
    }

    await this.getRepository().update({ id }, data as any);

    return await this.findById(id);
  }
}

export const organizationRepository = new OrganizationRepository();
