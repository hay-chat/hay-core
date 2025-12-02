import { BaseRepository } from "./base.repository";
import { PluginRegistry } from "@server/entities/plugin-registry.entity";

export class PluginRegistryRepository extends BaseRepository<PluginRegistry> {
  constructor() {
    super(PluginRegistry);
    // Repository will be lazily initialized by BaseRepository
  }

  async findByPluginId(pluginId: string): Promise<PluginRegistry | null> {
    return this.getRepository().findOne({ where: { pluginId } });
  }

  async getAllPlugins(): Promise<PluginRegistry[]> {
    return this.getRepository().find({
      order: { name: "ASC" },
    });
  }

  async getInstalledPlugins(): Promise<PluginRegistry[]> {
    return this.getRepository().find({
      where: { installed: true },
      order: { name: "ASC" },
    });
  }

  async getBuiltPlugins(): Promise<PluginRegistry[]> {
    return this.getRepository().find({
      where: { built: true },
      order: { name: "ASC" },
    });
  }

  async updateInstallStatus(id: string, installed: boolean, error?: string): Promise<void> {
    await this.getRepository().update(id, {
      installed,
      installedAt: installed ? new Date() : undefined,
      lastInstallError: error,
    } as any);
  }

  async updateBuildStatus(id: string, built: boolean, error?: string): Promise<void> {
    await this.getRepository().update(id, {
      built,
      builtAt: built ? new Date() : undefined,
      lastBuildError: error,
    } as any);
  }

  async updateChecksum(id: string, checksum: string): Promise<void> {
    await this.getRepository().update(id, { checksum } as any);
  }

  async upsertPlugin(plugin: Partial<PluginRegistry>): Promise<PluginRegistry> {
    const existing = await this.findByPluginId(plugin.pluginId!);

    if (existing) {
      await this.getRepository().update(existing.id, {
        ...plugin,
        updatedAt: new Date(),
      } as any);
      return (await this.getRepository().findOne({ where: { id: existing.id } }))!;
    } else {
      const entity = this.getRepository().create(plugin as PluginRegistry);
      return await this.getRepository().save(entity);
    }
  }

  /**
   * Find all plugins visible to an organization (core + org's custom)
   */
  override async findByOrganization(organizationId: string): Promise<PluginRegistry[]> {
    return this.getRepository().find({
      where: [{ sourceType: "core" }, { organizationId, sourceType: "custom" }],
      order: { name: "ASC" },
    });
  }

  /**
   * Find a specific custom plugin by pluginId and org
   */
  async findCustomByPluginId(
    pluginId: string,
    organizationId: string,
  ): Promise<PluginRegistry | null> {
    return this.getRepository().findOne({
      where: { pluginId, organizationId, sourceType: "custom" },
    });
  }

  /**
   * Delete a custom plugin
   */
  async deleteCustomPlugin(pluginId: string, organizationId: string): Promise<void> {
    await this.getRepository().delete({
      pluginId,
      organizationId,
      sourceType: "custom",
    });
  }
}

export const pluginRegistryRepository = new PluginRegistryRepository();
