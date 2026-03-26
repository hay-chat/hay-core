import { BaseRepository } from "./base.repository";
import { GitConnection } from "@server/entities/git-connection.entity";
import type { GitProvider as GitProviderType } from "@server/entities/git-connection.entity";

export class GitConnectionRepository extends BaseRepository<GitConnection> {
  constructor() {
    super(GitConnection);
  }

  async findById(id: string): Promise<GitConnection | null> {
    return this.getRepository().findOne({ where: { id } });
  }

  async findByOrganization(organizationId: string): Promise<GitConnection[]> {
    return this.getRepository().find({
      where: { organizationId },
      order: { createdAt: "DESC" },
    });
  }

  async findByInstallationId(
    provider: GitProviderType,
    installationId: string,
  ): Promise<GitConnection | null> {
    return this.getRepository().findOne({
      where: { provider, installationId },
    });
  }

  async findActiveByOrganization(organizationId: string): Promise<GitConnection[]> {
    return this.getRepository().find({
      where: { organizationId, status: "active" },
      order: { createdAt: "DESC" },
    });
  }

  async createConnection(data: Partial<GitConnection>): Promise<GitConnection> {
    const entity = this.getRepository().create(data as GitConnection);
    return this.getRepository().save(entity);
  }

  async updateStatus(id: string, status: GitConnection["status"], error?: string): Promise<void> {
    await this.getRepository().update(id, {
      status,
      lastSyncError: error || null,
      updatedAt: new Date(),
    } as any);
  }

  async updateSyncStatus(id: string, error?: string): Promise<void> {
    await this.getRepository().update(id, {
      lastSyncAt: new Date(),
      lastSyncError: error || null,
      updatedAt: new Date(),
    } as any);
  }

  async deleteConnection(id: string): Promise<void> {
    await this.getRepository().delete(id);
  }
}

export const gitConnectionRepository = new GitConnectionRepository();
