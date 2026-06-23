import type { DeepPartial, Repository } from "typeorm";
import { BaseRepository } from "./base.repository";
import { PluginRegistry, PluginStatus } from "@server/entities/plugin-registry.entity";
import type { HayPluginManifest } from "@server/types/plugin.types";
import type { PluginMetadata, PluginMetadataState } from "@server/types/plugin-sdk.types";

/**
 * The partial-entity shape accepted by TypeORM's `Repository.update`. Derived
 * from the public `Repository` API so we don't reach into TypeORM's internal
 * `query-builder/QueryPartialEntity` module (not exported in the package
 * `exports` map).
 */
type PluginRegistryUpdate = Parameters<Repository<PluginRegistry>["update"]>[1];

/**
 * Narrow an entity-shaped partial to TypeORM's update payload type.
 *
 * TypeORM's `QueryDeepPartialEntity` recursively deep-partials nested objects
 * and unions every leaf with `(() => string)`. That mangles the structured
 * `jsonb` columns (`manifest`, `metadata`) — e.g. it rejects a complete,
 * valid `HayPluginManifest` because a nested `Record<string, unknown>` field
 * doesn't match the deep-partialed leaf shape. `DeepPartial<PluginRegistry>`
 * is the type that actually describes our update payloads (it keeps jsonb
 * values whole), so we accept that and assert across to the update type at a
 * single, documented boundary. The two types describe partial column writes of
 * the same entity, so the runtime object is identical — the cast is safe.
 */
function toUpdatePayload(fields: DeepPartial<PluginRegistry>): PluginRegistryUpdate {
  return fields as PluginRegistryUpdate;
}

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
    });
  }

  async updateBuildStatus(id: string, built: boolean, error?: string): Promise<void> {
    await this.getRepository().update(id, {
      built,
      builtAt: built ? new Date() : undefined,
      lastBuildError: error,
    });
  }

  async updateChecksum(id: string, checksum: string): Promise<void> {
    await this.getRepository().update(id, { checksum });
  }

  async upsertPlugin(plugin: Partial<PluginRegistry>): Promise<PluginRegistry> {
    const existing = await this.findByPluginId(plugin.pluginId!);

    if (existing) {
      // Preserve sourceType — it's set at installation time and shouldn't be
      // overwritten by filesystem re-discovery (which always passes "custom"
      // for plugins under the custom/ directory, even if they're git-sourced)
      const { sourceType: _sourceType, ...updateFields } = plugin;

      // Repair: if the record has git metadata, ensure sourceType is "git"
      const resolvedSourceType = existing.gitConnectionId ? "git" : existing.sourceType;

      // If plugin source changed (checksum differs), reset install/build flags
      // so dependencies get reinstalled and code gets rebuilt
      const checksumChanged = updateFields.checksum && updateFields.checksum !== existing.checksum;

      const fields: DeepPartial<PluginRegistry> = {
        ...updateFields,
        sourceType: resolvedSourceType,
        status: PluginStatus.AVAILABLE, // Plugin exists on filesystem
        ...(checksumChanged ? { installed: false, built: false } : {}),
        updatedAt: new Date(),
      };
      await this.getRepository().update(existing.id, toUpdatePayload(fields));
      return (await this.getRepository().findOne({ where: { id: existing.id } }))!;
    } else {
      const entity = this.getRepository().create({
        ...plugin,
        status: PluginStatus.AVAILABLE, // New plugin is available
      } as PluginRegistry);
      return await this.getRepository().save(entity);
    }
  }

  /**
   * Find all plugins visible to an organization (core + org's custom + org's git)
   */
  override async findByOrganization(organizationId: string): Promise<PluginRegistry[]> {
    return this.getRepository().find({
      where: [
        { sourceType: "core" },
        { organizationId, sourceType: "custom" },
        { organizationId, sourceType: "git" },
      ],
      order: { name: "ASC" },
    });
  }

  /**
   * Find all git-sourced plugins (across all orgs, for sync job)
   */
  async findAllGitPlugins(): Promise<PluginRegistry[]> {
    return this.getRepository().find({
      where: { sourceType: "git" },
    });
  }

  /**
   * Find git-sourced plugins for a specific connection
   */
  async findByGitConnection(gitConnectionId: string): Promise<PluginRegistry[]> {
    return this.getRepository().find({
      where: { gitConnectionId },
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

  /**
   * Update plugin status
   */
  async updateStatus(id: string, status: PluginStatus): Promise<void> {
    await this.getRepository().update(id, { status });
  }

  /**
   * Find plugins by status
   */
  async findByStatus(status: PluginStatus): Promise<PluginRegistry[]> {
    return this.getRepository().find({
      where: { status },
      order: { name: "ASC" },
    });
  }

  /**
   * Find all plugins (no filters)
   */
  async findAll(): Promise<PluginRegistry[]> {
    return this.getRepository().find({
      order: { name: "ASC" },
    });
  }

  /**
   * Update plugin manifest (runtime metadata from worker)
   */
  async updateManifest(pluginId: string, manifest: HayPluginManifest): Promise<void> {
    const plugin = await this.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const fields: DeepPartial<PluginRegistry> = {
      manifest,
      updatedAt: new Date(),
    };
    await this.getRepository().update(plugin.id, toUpdatePayload(fields));
  }

  /**
   * Update SDK metadata (plugin-global)
   */
  async updateMetadata(
    pluginId: string,
    data: {
      metadata: PluginMetadata;
      metadataFetchedAt: Date;
      metadataState: PluginMetadataState;
    },
  ): Promise<void> {
    const plugin = await this.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const fields: DeepPartial<PluginRegistry> = {
      metadata: data.metadata,
      metadataFetchedAt: data.metadataFetchedAt,
      metadataState: data.metadataState,
      updatedAt: new Date(),
    };
    await this.getRepository().update(plugin.id, toUpdatePayload(fields));
  }

  /**
   * Update metadata state only
   */
  async updateMetadataState(id: string, metadataState: PluginMetadataState): Promise<void> {
    await this.getRepository().update(id, {
      metadataState,
      updatedAt: new Date(),
    });
  }
}

export const pluginRegistryRepository = new PluginRegistryRepository();
