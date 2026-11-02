import { Repository } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm";
import { Playbook, PlaybookStatus } from "../database/entities/playbook.entity";
import { AppDataSource } from "../database/data-source";

export class PlaybookRepository {
  private repository!: Repository<Playbook>;

  constructor() {
    // Lazy initialization
  }

  private getRepository(): Repository<Playbook> {
    if (!this.repository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(`Database not initialized. Cannot access Playbook repository.`);
      }
      this.repository = AppDataSource.getRepository(Playbook);
    }
    return this.repository;
  }

  async create(data: Partial<Playbook>): Promise<Playbook> {
    const playbook = this.getRepository().create(data);
    return await this.getRepository().save(playbook);
  }

  /**
   * @deprecated Use findByIdAndOrganization instead to ensure proper organization scoping
   */
  async findById(id: string): Promise<Playbook | null> {
    return await this.getRepository().findOne({
      where: { id },
    });
  }

  /**
   * Find playbook by ID and organizationId - ensures proper organization scoping
   */
  async findByIdAndOrganization(id: string, organizationId: string): Promise<Playbook | null> {
    return await this.getRepository().findOne({
      where: { id, organization_id: organizationId },
    });
  }

  async findByOrganization(organizationId: string): Promise<Playbook[]> {
    return await this.getRepository().find({
      where: { organization_id: organizationId },
      order: { created_at: "DESC" },
    });
  }

  async findByStatus(organizationId: string, status: PlaybookStatus): Promise<Playbook[]> {
    return await this.getRepository().find({
      where: { organization_id: organizationId, status },
      order: { created_at: "DESC" },
    });
  }

  async update(
    id: string,
    organizationId: string,
    data: Partial<Playbook>,
  ): Promise<Playbook | null> {
    const playbook = await this.findById(id);
    if (!playbook || playbook.organization_id !== organizationId) {
      return null;
    }

    // Note: Messages are created when a playbook is assigned to a conversation,
    // not when the playbook itself is updated. See conversation.entity.ts updatePlaybook method.

    if (Object.keys(data).length > 0) {
      await this.getRepository().update(
        { id, organization_id: organizationId },
        data as QueryDeepPartialEntity<Playbook>,
      );
    }

    return await this.findById(id);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.getRepository().delete({
      id,
      organization_id: organizationId,
    });

    return result.affected !== 0;
  }
}

export const playbookRepository = new PlaybookRepository();
