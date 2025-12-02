import { type FindManyOptions } from "typeorm";
import { BaseRepository } from "./base.repository";
import { PluginInstance } from "@server/entities/plugin-instance.entity";
import { pluginRegistryRepository } from "./plugin-registry.repository";
import { encryptConfig } from "@server/lib/auth/utils/encryption";
import type { HayPluginManifest } from "@server/types/plugin.types";

export class PluginInstanceRepository extends BaseRepository<PluginInstance> {
  constructor() {
    super(PluginInstance);
    // Repository will be lazily initialized by BaseRepository
  }

  async findByOrgAndPlugin(
    organizationId: string,
    pluginId: string,
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

  async findEnabledByOrganization(organizationId: string): Promise<PluginInstance[]> {
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

  async findOAuthInstances(): Promise<PluginInstance[]> {
    return this.getRepository().find({
      where: { authMethod: "oauth" },
      relations: ["plugin", "organization"],
    });
  }

  async findByPlugin(pluginRegistryId: string): Promise<PluginInstance[]> {
    return this.getRepository().find({
      where: { pluginId: pluginRegistryId },
      relations: ["plugin", "organization"],
    });
  }

  async updateStatus(id: string, status: PluginInstance["status"], error?: string): Promise<void> {
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

    await this.getRepository().update(id, updates as any);
  }

  async updateProcessId(id: string, processId: string | null): Promise<void> {
    await this.getRepository().update(id, {
      processId: processId || undefined,
    } as any);
  }

  async updateConfig(id: string, config: Record<string, unknown>): Promise<void> {
    // Get the plugin instance with its registry to access the manifest
    const instance = await this.getRepository().findOne({
      where: { id },
      relations: ["plugin"],
    });

    if (!instance) {
      throw new Error(`Plugin instance ${id} not found`);
    }

    const manifest = instance.plugin.manifest as HayPluginManifest;
    const configSchema = manifest.configSchema || {};

    // Encrypt sensitive fields before storing
    const encryptedConfig = encryptConfig(config, configSchema);

    await this.getRepository().update(id, { config: encryptedConfig } as any);
  }

  async incrementRestartCount(id: string): Promise<void> {
    await this.getRepository().increment({ id }, "restartCount", 1);
  }

  async updateHealthCheck(id: string): Promise<void> {
    await this.getRepository().update(id, {
      lastHealthCheck: new Date(),
    } as any);
  }

  async upsertInstance(
    organizationId: string,
    pluginId: string,
    data: Partial<PluginInstance>,
  ): Promise<PluginInstance> {
    // First, resolve the string plugin ID to a UUID by looking up the plugin registry
    const pluginRegistry = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!pluginRegistry) {
      throw new Error(`Plugin ${pluginId} not found in registry`);
    }

    // If config is provided, encrypt sensitive fields
    if (data.config) {
      const manifest = pluginRegistry.manifest as HayPluginManifest;
      const configSchema = manifest.configSchema || {};
      data.config = encryptConfig(data.config, configSchema);
    }

    const existing = await this.getRepository().findOne({
      where: { organizationId, pluginId: pluginRegistry.id },
      relations: ["plugin"],
    });

    if (existing) {
      await this.getRepository().update(existing.id, {
        ...data,
        updatedAt: new Date(),
      } as any);
      return (await this.findById(existing.id))!;
    } else {
      const entity = this.getRepository().create({
        ...data,
        organizationId,
        pluginId: pluginRegistry.id,
      } as PluginInstance);
      return await this.getRepository().save(entity);
    }
  }

  async enablePlugin(
    organizationId: string,
    pluginId: string,
    config?: Record<string, unknown>,
  ): Promise<PluginInstance> {
    // Get the plugin registry to access the manifest
    const pluginRegistry = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!pluginRegistry) {
      throw new Error(`Plugin ${pluginId} not found in registry`);
    }

    const manifest = pluginRegistry.manifest as HayPluginManifest;
    const configSchema = manifest.configSchema || {};

    // Encrypt sensitive fields before storing
    const encryptedConfig = config ? encryptConfig(config, configSchema) : undefined;

    return this.upsertInstance(organizationId, pluginId, {
      enabled: true,
      config: encryptedConfig,
    });
  }

  async disablePlugin(organizationId: string, pluginId: string): Promise<void> {
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
