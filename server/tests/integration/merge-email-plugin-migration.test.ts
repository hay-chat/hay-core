import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { randomUUID } from "crypto";
import { AppDataSource } from "../../database/data-source";
import { MergeEmailPluginIntoEmailInbox1785300000000 } from "../../database/migrations/1785300000000-MergeEmailPluginIntoEmailInbox";

/**
 * MergeEmailPluginIntoEmailInbox: old "Email" plugin installs are merged into
 * or moved to "Email inbox", and send-email action references follow.
 */
describe("MergeEmailPluginIntoEmailInbox1785300000000", () => {
  const OLD = "hay-plugin-email";
  const NEW = "hay-channel-email";
  const bothOrg = randomUUID();
  const onlyOldOrg = randomUUID();
  const onlyNewOrg = randomUUID();
  const orgs = [bothOrg, onlyOldOrg, onlyNewOrg];
  let createdNewRegistry = false;

  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    AppDataSource.query(sql, params);

  const runMigration = async () => {
    const queryRunner = AppDataSource.createQueryRunner();
    try {
      await new MergeEmailPluginIntoEmailInbox1785300000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }
  };

  const registryId = async (pluginId: string): Promise<string | null> =>
    (await q<{ id: string }>(`SELECT id FROM plugin_registry WHERE plugin_id = $1`, [pluginId]))[0]
      ?.id ?? null;

  const insertRegistry = async (pluginId: string, name: string): Promise<string> =>
    (
      await q<{ id: string }>(
        `INSERT INTO plugin_registry (plugin_id, name, version, manifest, plugin_path)
         VALUES ($1, $2, '1.0.0', '{}'::jsonb, $3) RETURNING id`,
        [pluginId, name, `core/${pluginId}`],
      )
    )[0].id;

  const insertInstance = async (
    orgId: string,
    pluginUuid: string,
    config: Record<string, unknown>,
    enabled = true,
  ): Promise<string> =>
    (
      await q<{ id: string }>(
        `INSERT INTO plugin_instances (organization_id, plugin_id, enabled, config, running, process_id, status, runtime_state)
         VALUES ($1, $2, $3, $4::jsonb, true, '123', 'running', 'ready') RETURNING id`,
        [orgId, pluginUuid, enabled, JSON.stringify(config)],
      )
    )[0].id;

  const instancesOf = (orgId: string) =>
    q<{
      id: string;
      plugin_id: string;
      enabled: boolean;
      config: Record<string, unknown> | null;
      running: boolean;
      runtime_state: string;
    }>(`SELECT * FROM plugin_instances WHERE organization_id = $1`, [orgId]);

  const cleanup = async () => {
    await q(`DELETE FROM conversations WHERE organization_id = ANY($1)`, [orgs]);
    await q(`DELETE FROM playbooks WHERE organization_id = ANY($1)`, [orgs]);
    await q(`DELETE FROM agents WHERE organization_id = ANY($1)`, [orgs]);
    await q(`DELETE FROM plugin_instances WHERE organization_id = ANY($1)`, [orgs]);
    await q(`DELETE FROM plugin_registry WHERE plugin_id = $1`, [OLD]);
  };

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.runMigrations();
    for (const [index, id] of orgs.entries()) {
      await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`, [
        id,
        `Email merge org ${index}`,
        `email-merge-${id}`,
      ]);
    }
  });

  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    if (createdNewRegistry) {
      await q(`DELETE FROM plugin_registry WHERE plugin_id = $1`, [NEW]);
    }
    await q(`DELETE FROM organizations WHERE id = ANY($1)`, [orgs]);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  const ensureNewRegistry = async (): Promise<string> => {
    const existing = await registryId(NEW);
    if (existing) {
      return existing;
    }
    createdNewRegistry = true;
    return insertRegistry(NEW, "Email inbox");
  };

  it("changes nothing when Email inbox is not in the registry", async () => {
    if (await registryId(NEW)) {
      // Another suite registered Email inbox in this database; the move/merge tests cover it.
      return;
    }
    const oldId = await insertRegistry(OLD, "Email");
    const instance = await insertInstance(onlyOldOrg, oldId, { recipients: "ops@acme.com" });
    const conversation = (
      await q<{ id: string }>(
        `INSERT INTO conversations (title, organization_id, enabled_tools)
         VALUES ('c', $1, $2) RETURNING id`,
        [onlyOldOrg, ["hay-plugin-email:send-email"]],
      )
    )[0].id;

    await runMigration();

    const rows = await instancesOf(onlyOldOrg);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: instance, plugin_id: oldId });
    expect(rows[0].config).toEqual({ recipients: "ops@acme.com" });
    expect(await registryId(OLD)).toBe(oldId);
    const [conv] = await q<{ enabled_tools: string[] }>(
      `SELECT enabled_tools FROM conversations WHERE id = $1`,
      [conversation],
    );
    expect(conv.enabled_tools).toEqual(["hay-plugin-email:send-email"]);
  });

  it("merges into an existing inbox, moves lone installs and leaves inbox-only orgs alone", async () => {
    const newId = await ensureNewRegistry();
    const oldId = await insertRegistry(OLD, "Email");
    const mcpCache = { mcpServers: { local: [{ serverId: "email-mcp", tools: [] }], remote: [] } };

    // Org with both: inbox gets the recipients, old instance removed.
    await insertInstance(bothOrg, oldId, { recipients: " ops@acme.com, boss@acme.com " }, false);
    const bothInbox = await insertInstance(bothOrg, newId, { supportAddress: "support@both.com" });
    // Org with only the old plugin: moved in place.
    const lone = await insertInstance(onlyOldOrg, oldId, {
      recipients: "team@lone.com",
      ...mcpCache,
    });
    // Inbox-only org already has notification recipients: untouched.
    await insertInstance(onlyNewOrg, newId, {
      supportAddress: "support@new.com",
      notificationRecipients: "keep@new.com",
    });

    await runMigration();

    const both = await instancesOf(bothOrg);
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({ id: bothInbox, plugin_id: newId, enabled: true });
    expect(both[0].config).toEqual({
      supportAddress: "support@both.com",
      notificationRecipients: "ops@acme.com, boss@acme.com",
    });

    const moved = await instancesOf(onlyOldOrg);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      id: lone,
      plugin_id: newId,
      enabled: true,
      running: false,
      runtime_state: "stopped",
    });
    expect(moved[0].config).toEqual({ notificationRecipients: "team@lone.com", ...mcpCache });

    const untouched = await instancesOf(onlyNewOrg);
    expect(untouched[0].config).toEqual({
      supportAddress: "support@new.com",
      notificationRecipients: "keep@new.com",
    });

    expect(await registryId(OLD)).toBeNull();
  });

  it("does not overwrite inbox recipients when merging", async () => {
    const newId = await ensureNewRegistry();
    const oldId = await insertRegistry(OLD, "Email");
    await insertInstance(bothOrg, oldId, { recipients: "old@acme.com" });
    await insertInstance(bothOrg, newId, { notificationRecipients: "new@acme.com" });

    await runMigration();

    const rows = await instancesOf(bothOrg);
    expect(rows).toHaveLength(1);
    expect(rows[0].config).toEqual({ notificationRecipients: "new@acme.com" });
  });

  it("rewrites send-email action references and is idempotent", async () => {
    await ensureNewRegistry();
    const chip = (id: string) => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Tell the team: " },
            { type: "actionMergeField", attrs: { id, name: "action" } },
          ],
        },
      ],
    });
    const playbook = (
      await q<{ id: string }>(
        `INSERT INTO playbooks (title, trigger, organization_id, instructions, prompt_template)
         VALUES ('Refunds', 'refund', $1, $2::jsonb, $3) RETURNING id`,
        [
          onlyOldOrg,
          JSON.stringify(chip("hay-plugin-email:send-email")),
          "Use <<action:hay-plugin-email:send-email>> then <<action:hay-plugin-email:healthcheck>>",
        ],
      )
    )[0].id;
    const agent = (
      await q<{ id: string }>(
        `INSERT INTO agents (name, organization_id, instructions, human_handoff_available_instructions)
         VALUES ('Agent', $1, $2, $3::jsonb) RETURNING id`,
        [
          onlyOldOrg,
          "call hay-plugin-email:send-email",
          JSON.stringify(chip("hay-plugin-email:send-email")),
        ],
      )
    )[0].id;
    const conversation = (
      await q<{ id: string }>(
        `INSERT INTO conversations (title, organization_id, enabled_tools)
         VALUES ('c', $1, $2) RETURNING id`,
        [onlyOldOrg, ["hay-plugin-shopify:find-order", "hay-plugin-email:send-email"]],
      )
    )[0].id;

    await runMigration();
    await runMigration();

    const [pb] = await q<{ instructions: unknown; prompt_template: string }>(
      `SELECT instructions, prompt_template FROM playbooks WHERE id = $1`,
      [playbook],
    );
    expect(pb.instructions).toEqual(chip("hay-channel-email:send-email"));
    expect(pb.prompt_template).toBe(
      "Use <<action:hay-channel-email:send-email>> then <<action:hay-plugin-email:healthcheck>>",
    );

    const [ag] = await q<{ instructions: string; human_handoff_available_instructions: unknown }>(
      `SELECT instructions, human_handoff_available_instructions FROM agents WHERE id = $1`,
      [agent],
    );
    expect(ag.instructions).toBe("call hay-channel-email:send-email");
    expect(ag.human_handoff_available_instructions).toEqual(chip("hay-channel-email:send-email"));

    const [conv] = await q<{ enabled_tools: string[] }>(
      `SELECT enabled_tools FROM conversations WHERE id = $1`,
      [conversation],
    );
    expect(conv.enabled_tools).toEqual([
      "hay-plugin-shopify:find-order",
      "hay-channel-email:send-email",
    ]);
  });
});
