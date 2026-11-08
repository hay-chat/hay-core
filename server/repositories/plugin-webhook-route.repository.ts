import { BaseRepository } from "./base.repository";
import { PluginWebhookRoute } from "../entities/plugin-webhook-route.entity";

export interface RouteClaimResult {
  /** Keys another organization holds; when non-empty nothing was changed. */
  conflicts: string[];
  /** Instances of other organizations the claim took keys from. */
  previousOwners: Array<{ organizationId: string; pluginInstanceId: string }>;
}

interface HeldRouteRow {
  id: string;
  routing_key: string;
  organization_id: string;
  plugin_instance_id: string;
  enabled: boolean;
}

/** Rolls the claim's transaction back. */
class RouteClaimConflict extends Error {
  constructor(readonly routingKeys: string[]) {
    super("Routing keys are held by another organization");
  }
}

export class PluginWebhookRouteRepository extends BaseRepository<PluginWebhookRoute> {
  constructor() {
    super(PluginWebhookRoute);
  }

  /**
   * Replace the set of routing keys owned by a plugin instance, atomically.
   *
   * A key held by another organization stays there while that organization's
   * instance is enabled: the claim then changes nothing and returns the keys in
   * `conflicts`. A disabled owner's key can always be reclaimed. `allowTransfer`
   * also takes keys from enabled owners, and is only for callers whose provider
   * authorization proves the account belongs to the claiming organization.
   */
  async claimRoutes(
    pluginId: string,
    organizationId: string,
    pluginInstanceId: string,
    routingKeys: string[],
    options: { allowTransfer?: boolean } = {},
  ): Promise<RouteClaimResult> {
    // Sorted so concurrent claims lock shared keys in the same order.
    const keys = [...new Set(routingKeys)].sort();

    try {
      return await this.getRepository().manager.transaction(async (manager) => {
        const held: HeldRouteRow[] =
          keys.length === 0
            ? []
            : await manager.query(
                `SELECT r.id, r.routing_key, r.organization_id, r.plugin_instance_id, i.enabled
                 FROM plugin_webhook_routes r
                 JOIN plugin_instances i ON i.id = r.plugin_instance_id
                 WHERE r.plugin_id = $1 AND r.routing_key = ANY($2) AND r.organization_id <> $3
                 ORDER BY r.routing_key
                 FOR UPDATE OF r`,
                [pluginId, keys, organizationId],
              );

        if (!options.allowTransfer) {
          const conflicts = held.filter((row) => row.enabled).map((row) => row.routing_key);
          if (conflicts.length > 0) throw new RouteClaimConflict(conflicts);
        }

        const repository = manager.getRepository(PluginWebhookRoute);
        await repository.delete({ pluginInstanceId });
        if (held.length > 0) await repository.delete(held.map((row) => row.id));

        if (keys.length > 0) {
          // A concurrent first claim commits between the check above and this
          // insert; the WHERE leaves that row alone and it comes back short.
          const inserted: Array<{ routing_key: string }> = await manager.query(
            `INSERT INTO plugin_webhook_routes
               (plugin_id, routing_key, organization_id, plugin_instance_id)
             SELECT $1, key, $2, $3 FROM unnest($4::text[]) AS key
             ON CONFLICT (plugin_id, routing_key) DO UPDATE
               SET plugin_instance_id = EXCLUDED.plugin_instance_id, updated_at = now()
               WHERE plugin_webhook_routes.organization_id = EXCLUDED.organization_id
             RETURNING routing_key`,
            [pluginId, organizationId, pluginInstanceId, keys],
          );
          if (inserted.length < keys.length) {
            const claimed = new Set(inserted.map((row) => row.routing_key));
            throw new RouteClaimConflict(keys.filter((key) => !claimed.has(key)));
          }
        }

        return {
          conflicts: [],
          previousOwners: [
            ...new Map(
              held.map((row) => [
                row.plugin_instance_id,
                { organizationId: row.organization_id, pluginInstanceId: row.plugin_instance_id },
              ]),
            ).values(),
          ],
        };
      });
    } catch (error) {
      if (error instanceof RouteClaimConflict) {
        return { conflicts: error.routingKeys, previousOwners: [] };
      }
      throw error;
    }
  }

  /**
   * Resolve the owner of a (pluginId, routingKey) pair.
   */
  async findByKey(
    pluginId: string,
    routingKey: string,
  ): Promise<{ organizationId: string; pluginInstanceId: string } | null> {
    const row = await this.getRepository().findOne({
      where: { pluginId, routingKey },
      select: ["organizationId", "pluginInstanceId"],
    });

    if (!row) {
      return null;
    }

    return {
      organizationId: row.organizationId,
      pluginInstanceId: row.pluginInstanceId,
    };
  }

  /** How many routing keys a plugin instance still owns. */
  async countForInstance(pluginInstanceId: string): Promise<number> {
    return this.getRepository().count({ where: { pluginInstanceId } });
  }

  /** Remove all routes owned by a plugin instance (e.g. on disconnect). */
  async clearForInstance(pluginInstanceId: string): Promise<void> {
    await this.getRepository().delete({ pluginInstanceId });
  }
}

export const pluginWebhookRouteRepository = new PluginWebhookRouteRepository();
