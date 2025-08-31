import { Repository } from "typeorm";
import { Job } from "@server/entities/job.entity";
import { AppDataSource } from "@server/database/data-source";

export class JobRepository {
  private repository: Repository<Job>;

  constructor() {
    this.repository = AppDataSource.getRepository(Job);
  }

  async create(data: Partial<Job>): Promise<Job> {
    const job = this.repository.create(data);
    return await this.repository.save(job);
  }

  async findById(id: string, organizationId: string): Promise<Job | null> {
    return await this.repository.findOne({
      where: { id, organizationId },
    });
  }

  async findByOrganization(organizationId: string): Promise<Job[]> {
    return await this.repository.find({
      where: { organizationId },
      order: { createdAt: "DESC" },
    });
  }

  async update(
    id: string,
    organizationId: string,
    updates: Partial<Job>
  ): Promise<Job | null> {
    const job = await this.findById(id, organizationId);
    if (!job) return null;

    Object.assign(job, updates);
    return await this.repository.save(job);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.repository.delete({ id, organizationId });
    return result.affected !== 0;
  }
}

export const jobRepository = new JobRepository();