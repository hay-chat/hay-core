import { Repository } from "typeorm";
import {
  PlaybookVersion,
  PlaybookVersionStatus,
} from "../database/entities/playbook-version.entity";
import { AppDataSource } from "../database/data-source";

export class PlaybookVersionRepository {
  private repository!: Repository<PlaybookVersion>;

  constructor() {
    // Lazy initialization
  }

  private getRepository(): Repository<PlaybookVersion> {
    if (!this.repository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error("Database not initialized. Cannot access PlaybookVersion repository.");
      }
      this.repository = AppDataSource.getRepository(PlaybookVersion);
    }
    return this.repository;
  }

  async findByPlaybookId(playbookId: string): Promise<PlaybookVersion[]> {
    return await this.getRepository().find({
      where: { playbook_id: playbookId },
      relations: ["created_by", "published_by"],
      order: { version_number: "DESC" },
    });
  }

  async findById(id: string): Promise<PlaybookVersion | null> {
    return await this.getRepository().findOne({
      where: { id },
      relations: ["created_by", "published_by"],
    });
  }

  async findDraftByPlaybookId(playbookId: string): Promise<PlaybookVersion | null> {
    return await this.getRepository().findOne({
      where: { playbook_id: playbookId, status: PlaybookVersionStatus.DRAFT },
      relations: ["created_by", "published_by"],
    });
  }

  async findActiveByPlaybookId(playbookId: string): Promise<PlaybookVersion | null> {
    return await this.getRepository().findOne({
      where: { playbook_id: playbookId, status: PlaybookVersionStatus.ACTIVE },
      relations: ["created_by", "published_by"],
    });
  }

  async getNextVersionNumber(playbookId: string): Promise<number> {
    const result = await this.getRepository()
      .createQueryBuilder("pv")
      .select("MAX(pv.version_number)", "max")
      .where("pv.playbook_id = :playbookId", { playbookId })
      .getRawOne();

    return (result?.max || 0) + 1;
  }

  async create(data: Partial<PlaybookVersion>): Promise<PlaybookVersion> {
    const version = this.getRepository().create(data);
    return await this.getRepository().save(version);
  }

  async update(id: string, data: Partial<PlaybookVersion>): Promise<PlaybookVersion | null> {
    await this.getRepository().update({ id }, data as any);
    return await this.findById(id);
  }

  async archiveActiveByPlaybookId(playbookId: string): Promise<void> {
    await this.getRepository().update(
      { playbook_id: playbookId, status: PlaybookVersionStatus.ACTIVE },
      { status: PlaybookVersionStatus.ARCHIVED },
    );
  }

  async deleteDraftByPlaybookId(playbookId: string): Promise<void> {
    await this.getRepository().delete({
      playbook_id: playbookId,
      status: PlaybookVersionStatus.DRAFT,
    });
  }
}

export const playbookVersionRepository = new PlaybookVersionRepository();
