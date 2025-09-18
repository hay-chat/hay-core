import { Repository } from "typeorm";
import { Job } from "@server/entities/job.entity";
import { AppDataSource } from "@server/database/data-source";

export class JobRepository {
  private repository!: Repository<Job>;

  constructor() {
    // Lazy initialization
  }

  private getRepository(): Repository<Job> {
    if (!this.repository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(`Database not initialized. Cannot access Job repository.`);
      }
      this.repository = AppDataSource.getRepository(Job);
    }
    return this.repository;
  }

  async create(data: Partial<Job>): Promise<Job> {
    const job = this.getRepository().create(data);
    return await this.getRepository().save(job);
  }

  async findById(id: string): Promise<Job | null> {
    return await this.getRepository().findOne({
      where: { id },
    });
  }

  async findByOrganization(organizationId: string): Promise<Job[]> {
    return await this.getRepository().find({
      where: { organizationId },
      order: { createdAt: "DESC" },
    });
  }

  async update(id: string, organizationId: string, updates: Partial<Job>): Promise<Job | null> {
    const job = await this.findById(id);
    if (!job || job.organizationId !== organizationId) return null;

    Object.assign(job, updates);
    return await this.getRepository().save(job);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.getRepository().delete({ id, organizationId });
    return result.affected !== 0;
  }
}

export const jobRepository = new JobRepository();
