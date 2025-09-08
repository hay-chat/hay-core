import { Repository, type FindManyOptions } from "typeorm";
import { BaseRepository } from "./base.repository";
import { PluginInstance } from "@server/entities/plugin-instance.entity";
import { pluginRegistryRepository } from "./plugin-registry.repository";

export class PluginInstanceRepository extends BaseRepository<PluginInstance> {
  constructor() {
    super(PluginInstance);
    // Repository will be lazily initialized by BaseRepository
  }

  async findByOrgAndPlugin(
    organizationId: string,
    pluginId: string
  ): Promise<PluginInstance | null> {
    // First, resolve the string plugin ID to a UUID by looking up the plugin registry
    const pluginRegistry = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!pluginRegistry) {
      return null;
    }

    return this.getRepository().findOne({
      where: { organizationId, pluginId: pluginRegistry.id },
      relations: ["plugin"],
    });
  }

  override async findByOrganization(organizationId: string): Promise<PluginInstance[]> {
    return this.getRepository().find({
      where: { organizationId },
      relations: ["plugin"],
      order: { createdAt: "ASC" },
    });
  }

  async findAll(options?: FindManyOptions<PluginInstance>): Promise<PluginInstance[]> {
    return this.getRepository().find(options);
  }

  async findEnabledByOrganization(
    organizationId: string
  ): Promise<PluginInstance[]> {
    return this.getRepository().find({
      where: { organizationId, enabled: true },
      relations: ["plugin"],
    });
  }

  async findRunningInstances(): Promise<PluginInstance[]> {
    return this.getRepository().find({
      where: { running: true },
      relations: ["plugin", "organization"],
    });
  }

  async updateStatus(
    id: string,
    status: PluginInstance["status"],
    error?: string
  ): Promise<void> {
    const updates: Partial<PluginInstance> = { status };
    
    if (status === "running") {
      updates.running = true;
      updates.lastStartedAt = new Date();
    } else if (status === "stopped") {
      updates.running = false;
      updates.lastStoppedAt = new Date();
      updates.processId = undefined;
    } else if (status === "error") {
      updates.running = false;
      updates.lastError = error;
    }

    await this.getRepository().update(id, updates);
  }

  async updateProcessId(id: string, processId: string | null): Promise<void> {
    await this.getRepository().update(id, {
      processId: processId || undefined,
    });
  }

  async updateConfig(
    id: string,
    config: Record<string, any>
  ): Promise<void> {
    await this.getRepository().update(id, { config });
  }

  async incrementRestartCount(id: string): Promise<void> {
    await this.getRepository().increment({ id }, "restartCount", 1);
  }

  async updateHealthCheck(id: string): Promise<void> {
    await this.getRepository().update(id, {
      lastHealthCheck: new Date(),
    });
  }

  async upsertInstance(
    organizationId: string,
    pluginId: string,
    data: Partial<PluginInstance>
  ): Promise<PluginInstance> {
    const existing = await this.findByOrgAndPlugin(organizationId, pluginId);
    
    if (existing) {
      await this.getRepository().update(existing.id, {
        ...data,
        updatedAt: new Date(),
      });
      return (await this.findById(existing.id))!;
    } else {
      const entity = this.getRepository().create({
        ...data,
        organizationId,
        pluginId,
      } as PluginInstance);
      return await this.getRepository().save(entity);
    }
  }

  async enablePlugin(
    organizationId: string,
    pluginId: string,
    config?: Record<string, any>
  ): Promise<PluginInstance> {
    return this.upsertInstance(organizationId, pluginId, {
      enabled: true,
      config,
    });
  }

  async disablePlugin(
    organizationId: string,
    pluginId: string
  ): Promise<void> {
    const instance = await this.findByOrgAndPlugin(organizationId, pluginId);
    if (instance) {
      await this.update(instance.id, organizationId, {
        enabled: false,
        running: false,
        processId: undefined,
        status: "stopped",
      });
    }
  }
}

export const pluginInstanceRepository = new PluginInstanceRepository();