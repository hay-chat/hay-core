import { Repository } from "typeorm";
import { Job, JobStatus } from "@server/entities/job.entity";
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

  /**
   * Find an in-flight (not-yet-terminal) sync job for a given document source.
   * Used to keep enqueueSync idempotent so the 60s dispatcher does not pile up
   * a fresh job every tick while an earlier one is still queued or running.
   */
  async findActiveSyncJob(documentSourceId: string): Promise<Job | null> {
    return await this.getRepository()
      .createQueryBuilder("job")
      .where("job.data->>'type' = :type", { type: "document_source_sync" })
      .andWhere("job.data->>'documentSourceId' = :id", { id: documentSourceId })
      .andWhere("job.status IN (:...statuses)", {
        statuses: [JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING],
      })
      .orderBy("job.created_at", "DESC")
      .getOne();
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
