import { Repository } from "typeorm";
import { BaseRepository } from "./base.repository";
import { PluginRegistry } from "@server/entities/plugin-registry.entity";
import { AppDataSource } from "@server/database/data-source";

export class PluginRegistryRepository extends BaseRepository<PluginRegistry> {
  protected repository: Repository<PluginRegistry>;

  constructor() {
    super(PluginRegistry);
    this.repository = AppDataSource.getRepository(PluginRegistry);
  }

  async findByName(name: string): Promise<PluginRegistry | null> {
    return this.repository.findOne({ where: { name } });
  }

  async getAllPlugins(): Promise<PluginRegistry[]> {
    return this.repository.find({
      order: { name: "ASC" },
    });
  }

  async getInstalledPlugins(): Promise<PluginRegistry[]> {
    return this.repository.find({
      where: { installed: true },
      order: { name: "ASC" },
    });
  }

  async getBuiltPlugins(): Promise<PluginRegistry[]> {
    return this.repository.find({
      where: { built: true },
      order: { name: "ASC" },
    });
  }

  async updateInstallStatus(
    id: string,
    installed: boolean,
    error?: string
  ): Promise<void> {
    await this.repository.update(id, {
      installed,
      installedAt: installed ? new Date() : undefined,
      lastInstallError: error,
    });
  }

  async updateBuildStatus(
    id: string,
    built: boolean,
    error?: string
  ): Promise<void> {
    await this.repository.update(id, {
      built,
      builtAt: built ? new Date() : undefined,
      lastBuildError: error,
    });
  }

  async updateChecksum(id: string, checksum: string): Promise<void> {
    await this.repository.update(id, { checksum });
  }

  async upsertPlugin(plugin: Partial<PluginRegistry>): Promise<PluginRegistry> {
    const existing = await this.findByName(plugin.name!);
    
    if (existing) {
      await this.repository.update(existing.id, {
        ...plugin,
        updatedAt: new Date(),
      });
      return (await this.repository.findOne({ where: { id: existing.id } }))!;
    } else {
      const entity = this.repository.create(plugin as PluginRegistry);
      return await this.repository.save(entity);
    }
  }
}

export const pluginRegistryRepository = new PluginRegistryRepository();