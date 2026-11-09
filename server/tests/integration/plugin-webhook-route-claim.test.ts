/**
 * Routing-key ownership against a real database: a key stays with the
 * organization holding it until that organization's instance is disabled.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "@server/database/data-source";
import { pluginWebhookRouteRepository } from "@server/repositories/plugin-webhook-route.repository";

const ORG_A = "d0000001-0000-4000-8000-0000000000a1";
const ORG_B = "d0000001-0000-4000-8000-0000000000b2";
const INSTANCE_A = "d0000001-0000-4000-8000-0000000000c1";
const INSTANCE_B = "d0000001-0000-4000-8000-0000000000c2";
const REGISTRY_ID = "d0000001-0000-4000-8000-0000000000f1";
const PLUGIN_ID = "hay-plugin-route-claim-test";

async function cleanup(): Promise<void> {
  await AppDataSource.query(`DELETE FROM plugin_webhook_routes WHERE plugin_id = $1`, [PLUGIN_ID]);
  await AppDataSource.query(`DELETE FROM plugin_instances WHERE id = ANY($1)`, [
    [INSTANCE_A, INSTANCE_B],
  ]);
  await AppDataSource.query(`DELETE FROM plugin_registry WHERE id = $1`, [REGISTRY_ID]);
  await AppDataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[ORG_A, ORG_B]]);
}

const owner = (key: string) => pluginWebhookRouteRepository.findByKey(PLUGIN_ID, key);
const claim = (
  org: string,
  instance: string,
  keys: string[],
  options?: { allowTransfer?: boolean },
) => pluginWebhookRouteRepository.claimRoutes(PLUGIN_ID, org, instance, keys, options);

describe("plugin webhook route claims", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  });

  afterAll(async () => {
    await cleanup();
    await AppDataSource.destroy();
  });

  beforeEach(async () => {
    await cleanup();
    for (const [id, slug] of [
      [ORG_A, "route-claim-a"],
      [ORG_B, "route-claim-b"],
    ]) {
      await AppDataSource.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $2)`, [
        id,
        slug,
      ]);
    }
    await AppDataSource.query(
      `INSERT INTO plugin_registry (id, plugin_id, name, version, plugin_path, manifest)
       VALUES ($1, $2, 'Route Claim', '0.0.0', 'route/claim', '{}')`,
      [REGISTRY_ID, PLUGIN_ID],
    );
    for (const [id, org] of [
      [INSTANCE_A, ORG_A],
      [INSTANCE_B, ORG_B],
    ]) {
      await AppDataSource.query(
        `INSERT INTO plugin_instances (id, organization_id, plugin_id, enabled) VALUES ($1, $2, $3, true)`,
        [id, org, REGISTRY_ID],
      );
    }
  });

  it("refuses a second organization and leaves both sets of keys untouched", async () => {
    await claim(ORG_A, INSTANCE_A, ["shared"]);
    await claim(ORG_B, INSTANCE_B, ["own"]);

    const result = await claim(ORG_B, INSTANCE_B, ["shared", "new"]);

    expect(result.conflicts).toEqual(["shared"]);
    expect(await owner("shared")).toMatchObject({ organizationId: ORG_A });
    expect(await owner("own")).toMatchObject({ organizationId: ORG_B });
    expect(await owner("new")).toBeNull();
  });

  it("lets only one of two simultaneous first claims win", async () => {
    const results = await Promise.all([
      claim(ORG_A, INSTANCE_A, ["contested"]),
      claim(ORG_B, INSTANCE_B, ["contested"]),
    ]);

    expect(results.filter((result) => result.conflicts.length === 0)).toHaveLength(1);
    expect(results.filter((result) => result.conflicts.length === 1)).toHaveLength(1);
  });

  it("replaces an organization's own keys", async () => {
    await claim(ORG_A, INSTANCE_A, ["old"]);

    await claim(ORG_A, INSTANCE_A, ["new"]);

    expect(await owner("old")).toBeNull();
    expect(await owner("new")).toMatchObject({ organizationId: ORG_A });
  });

  it("reclaims a key from a disabled instance", async () => {
    await claim(ORG_A, INSTANCE_A, ["shared"]);
    await AppDataSource.query(`UPDATE plugin_instances SET enabled = false WHERE id = $1`, [
      INSTANCE_A,
    ]);

    const result = await claim(ORG_B, INSTANCE_B, ["shared"]);

    expect(result.conflicts).toEqual([]);
    expect(await owner("shared")).toMatchObject({ organizationId: ORG_B });
  });

  it("moves a key on request and names the previous owner", async () => {
    await claim(ORG_A, INSTANCE_A, ["shared"]);

    const result = await claim(ORG_B, INSTANCE_B, ["shared"], { allowTransfer: true });

    expect(result.previousOwners).toEqual([
      { organizationId: ORG_A, pluginInstanceId: INSTANCE_A },
    ]);
    expect(await owner("shared")).toMatchObject({ organizationId: ORG_B });
  });
});
