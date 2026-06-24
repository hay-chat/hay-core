/**
 * Product Source Coordinator
 *
 * Owns periodic re-sync of every org × enabled product-source plugin.
 *
 * The actual ingestion (Shopify → CanonicalProduct → upsert) runs inside
 * each plugin worker — the worker's `onStart` is the natural place to do
 * bulk sync, and the plugin author may schedule their own incremental
 * refresh from there. This coordinator's job is to keep those workers
 * running for orgs that have the capability enabled, so they get the
 * scheduled wake-up.
 */

import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { pluginInstanceManagerService } from "./plugin-instance-manager.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("product-source-coordinator");

export class ProductSourceCoordinator {
  /**
   * For each (org, plugin) with the `products` capability enabled, make
   * sure the worker is running and bump its activity timestamp so the
   * inactivity-cleanup job doesn't stop it mid-sync.
   */
  async syncAllOrgs(): Promise<{ ensured: number; errors: number }> {
    const instances = await pluginInstanceRepository.findEnabledInstancesByCapability("products");
    if (!instances.length) {
      logger.debug("No enabled product-source plugins; nothing to do");
      return { ensured: 0, errors: 0 };
    }

    let ensured = 0;
    let errors = 0;

    for (const instance of instances) {
      const pluginId = instance.plugin?.pluginId;
      if (!pluginId) continue;

      try {
        await pluginInstanceManagerService.ensureInstanceRunning(instance.organizationId, pluginId);
        await pluginInstanceManagerService.updateActivityTimestamp(
          instance.organizationId,
          pluginId,
        );
        ensured++;
      } catch (err) {
        errors++;
        logger.error(
          { err, organizationId: instance.organizationId, pluginId },
          "Failed to ensure product-source plugin running",
        );
      }
    }

    logger.info(
      { ensured, errors, total: instances.length },
      "Product-source coordinator tick complete",
    );
    return { ensured, errors };
  }
}

export const productSourceCoordinator = new ProductSourceCoordinator();
