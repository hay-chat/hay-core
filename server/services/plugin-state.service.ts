/**
 * Plugin state store (H4)
 *
 * A small key/value store a plugin worker keeps across restarts, scoped to
 * (organization, authenticated plugin id). Values are JSON, encrypted at rest
 * because plugins park credentials here between steps of a flow (e.g. keys
 * WooCommerce posted that the settings UI has not collected yet). Expired keys
 * read as missing and are reaped on the plugin's next write.
 */

import { LessThan } from "typeorm";
import { AppDataSource } from "../database/data-source";
import { PluginState } from "../database/entities/plugin-state.entity";
import { decryptValue, encryptValue } from "../lib/auth/utils/encryption";

/** Largest serialized value accepted (characters of JSON). */
export const PLUGIN_STATE_MAX_VALUE_LENGTH = 64 * 1024;
/** Most live keys one plugin keeps per organization. */
export const PLUGIN_STATE_MAX_KEYS = 500;

export class PluginStateLimitError extends Error {}

export class PluginStateService {
  private repo() {
    return AppDataSource.getRepository(PluginState);
  }

  async get(organizationId: string, pluginId: string, key: string): Promise<unknown | null> {
    const row = await this.repo().findOne({ where: { organizationId, pluginId, key } });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      await this.repo().delete({ id: row.id });
      return null;
    }
    return JSON.parse(decryptValue(row.value));
  }

  async set(
    organizationId: string,
    pluginId: string,
    key: string,
    value: unknown,
    ttlMs?: number,
  ): Promise<void> {
    const json = JSON.stringify(value ?? null);
    if (json.length > PLUGIN_STATE_MAX_VALUE_LENGTH) {
      throw new PluginStateLimitError(
        `State value for "${key}" is larger than ${PLUGIN_STATE_MAX_VALUE_LENGTH} characters`,
      );
    }
    const repo = this.repo();
    await repo.delete({ organizationId, pluginId, expiresAt: LessThan(new Date()) });

    const existing = await repo.findOne({ where: { organizationId, pluginId, key } });
    if (
      !existing &&
      (await repo.count({ where: { organizationId, pluginId } })) >= PLUGIN_STATE_MAX_KEYS
    ) {
      throw new PluginStateLimitError(`A plugin keeps at most ${PLUGIN_STATE_MAX_KEYS} state keys`);
    }
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;
    await repo.upsert(
      { organizationId, pluginId, key, value: encryptValue(json), expiresAt },
      { conflictPaths: ["organizationId", "pluginId", "key"] },
    );
  }

  async delete(organizationId: string, pluginId: string, key: string): Promise<void> {
    await this.repo().delete({ organizationId, pluginId, key });
  }
}

export const pluginStateService = new PluginStateService();
