import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { PluginState } from "../../database/entities/plugin-state.entity";
import {
  PLUGIN_STATE_MAX_VALUE_LENGTH,
  PluginStateLimitError,
  pluginStateService,
} from "../../services/plugin-state.service";

/**
 * H4: plugins keep short-lived state (e.g. a pending WooCommerce connect) in
 * core so it survives a worker or server restart. Scoped by org + plugin id,
 * encrypted at rest, TTL-bounded.
 */
describe("pluginStateService (H4)", () => {
  const orgId = "4a400000-0000-4000-8000-000000000001";
  const otherOrgId = "4a400000-0000-4000-8000-000000000002";
  const rows = () => AppDataSource.getRepository(PluginState);

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "plugin-state-org"],
      [otherOrgId, "plugin-state-other-org"],
    ]) {
      if (!(await orgRepo.findOne({ where: { id } }))) {
        await orgRepo.save(orgRepo.create({ id, name: slug, slug }));
      }
    }
  });

  beforeEach(async () => {
    await rows().delete({ organizationId: orgId });
    await rows().delete({ organizationId: otherOrgId });
  });

  afterAll(async () => {
    await rows().delete({ organizationId: orgId });
    await rows().delete({ organizationId: otherOrgId });
  });

  it("round-trips JSON, encrypted at rest, and overwrites by key", async () => {
    await pluginStateService.set(orgId, "hay-plugin-a", "k", { secret: "cs_123", n: 1 });
    await pluginStateService.set(orgId, "hay-plugin-a", "k", { secret: "cs_456", n: 2 });

    expect(await pluginStateService.get(orgId, "hay-plugin-a", "k")).toEqual({
      secret: "cs_456",
      n: 2,
    });
    const stored = await rows().find({ where: { organizationId: orgId } });
    expect(stored).toHaveLength(1);
    expect(stored[0].value).not.toContain("cs_456");
  });

  it("isolates by organization and plugin", async () => {
    await pluginStateService.set(orgId, "hay-plugin-a", "k", "mine");
    expect(await pluginStateService.get(orgId, "hay-plugin-b", "k")).toBeNull();
    expect(await pluginStateService.get(otherOrgId, "hay-plugin-a", "k")).toBeNull();
  });

  it("treats expired keys as missing and deletes them", async () => {
    await pluginStateService.set(orgId, "hay-plugin-a", "k", "soon gone", 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(await pluginStateService.get(orgId, "hay-plugin-a", "k")).toBeNull();
    expect(await rows().count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("deletes a key", async () => {
    await pluginStateService.set(orgId, "hay-plugin-a", "k", 1);
    await pluginStateService.delete(orgId, "hay-plugin-a", "k");
    expect(await pluginStateService.get(orgId, "hay-plugin-a", "k")).toBeNull();
  });

  it("rejects oversized values", async () => {
    await expect(
      pluginStateService.set(orgId, "hay-plugin-a", "k", "x".repeat(PLUGIN_STATE_MAX_VALUE_LENGTH + 1)),
    ).rejects.toBeInstanceOf(PluginStateLimitError);
  });
});
