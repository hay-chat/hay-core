import { BaseRepository } from "./base.repository";
import { PluginWebhookRoute } from "../entities/plugin-webhook-route.entity";

export class PluginWebhookRouteRepository extends BaseRepository<PluginWebhookRoute> {
  constructor() {
    super(PluginWebhookRoute);
  }

  /**
   * Insert-or-update the set of routing keys owned by a plugin instance.
   *
   * The (pluginId, routingKey) pair is unique. On conflict the existing row is
   * reassigned to the supplied organization + instance (last connect wins), so a
   * routing key previously owned by another instance is transferred cleanly.
   */
  async upsertRoutes(
    pluginId: string,
    organizationId: string,
    pluginInstanceId: string,
    routingKeys: string[],
  ): Promise<void> {
    if (routingKeys.length === 0) {
      return;
    }

    const rows = routingKeys.map((routingKey) => ({
      pluginId,
      routingKey,
      organizationId,
      pluginInstanceId,
    }));

    await this.getRepository()
      .createQueryBuilder()
      .insert()
      .into(PluginWebhookRoute)
      .values(rows)
      .orUpdate(
        ["organization_id", "plugin_instance_id", "updated_at"],
        ["plugin_id", "routing_key"],
      )
      .execute();
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

  /**
   * Remove all routes owned by a plugin instance (e.g. on disconnect).
   */
  async clearForInstance(pluginInstanceId: string): Promise<void> {
    await this.getRepository().delete({ pluginInstanceId });
  }
}

export const pluginWebhookRouteRepository = new PluginWebhookRouteRepository();
