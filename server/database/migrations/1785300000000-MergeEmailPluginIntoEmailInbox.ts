import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The standalone "Email" plugin (hay-plugin-email: a `send-email` tool that
 * mailed a configured recipient list) was merged into "Email inbox"
 * (hay-channel-email), which keeps its id so its webhook URL is unchanged.
 * Plugin ids appear here only as data.
 *
 * Existing installs of the old plugin:
 *  - Org also has Email inbox: the old `recipients` setting is copied to the
 *    inbox's `notificationRecipients` (unless the inbox already has one) and
 *    the old instance is deleted. The inbox's own enabled state is kept.
 *  - Org has only the old plugin: the instance is moved to Email inbox in
 *    place (plugin_id re-pointed, `recipients` renamed to
 *    `notificationRecipients`, runtime columns reset, enabled state kept), so
 *    the org's send-email action keeps working with the same recipients and
 *    nothing needs to be noted for the merchant. The channel part stays
 *    inactive until they save a support address and set up forwarding.
 *  - Email inbox not in the registry (never discovered on this host): nothing
 *    is changed (no instance is moved or deleted, references are kept) and a
 *    warning is logged, so no data is destroyed.
 *
 * Action references `hay-plugin-email:send-email` in playbooks, playbook
 * versions, agent instructions and conversations' enabled_tools are rewritten
 * to `hay-channel-email:send-email`. The old `healthcheck` tool has no
 * successor; references to it (unlikely) are left as they are. Finally the
 * old registry row is deleted.
 *
 * Idempotent: a second run finds nothing to change.
 */

const OLD_PLUGIN = "hay-plugin-email";
const NEW_PLUGIN = "hay-channel-email";
const OLD_ACTION = `${OLD_PLUGIN}:send-email`;
const NEW_ACTION = `${NEW_PLUGIN}:send-email`;

/**
 * Columns that can hold action references. Their SQL type is read from the
 * catalog at run time rather than listed here: `agents.instructions` is text
 * on some hosts and jsonb on others (production), and a hardcoded type made
 * this migration fail with "column is of type jsonb but expression is of type
 * text" and roll the whole release batch back.
 */
const REFERENCE_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "playbooks", column: "instructions" },
  { table: "playbooks", column: "prompt_template" },
  { table: "playbook_versions", column: "instructions" },
  { table: "playbook_versions", column: "prompt_template" },
  { table: "agents", column: "instructions" },
  { table: "agents", column: "human_handoff_available_instructions" },
  { table: "agents", column: "human_handoff_unavailable_instructions" },
];

export class MergeEmailPluginIntoEmailInbox1785300000000 implements MigrationInterface {
  name = "MergeEmailPluginIntoEmailInbox1785300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const oldRows: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM plugin_registry WHERE plugin_id = $1`,
      [OLD_PLUGIN],
    );
    const newRows: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM plugin_registry WHERE plugin_id = $1`,
      [NEW_PLUGIN],
    );
    const oldId = oldRows[0]?.id ?? null;
    const newId = newRows[0]?.id ?? null;

    if (oldId && !newId) {
      console.warn(
        `Warning: MergeEmailPluginIntoEmailInbox skipped: ${OLD_PLUGIN} is installed but ${NEW_PLUGIN} is not in plugin_registry, so its instances were left as they are.`,
      );
      return;
    }

    await this.rewriteActionReferences(queryRunner);
    if (!oldId) {
      return;
    }

    // Orgs with both: carry the recipients over, then drop the old instance.
    await queryRunner.query(
      `
      UPDATE plugin_instances inbox
      SET config = COALESCE(inbox.config, '{}'::jsonb)
            || jsonb_build_object('notificationRecipients', TRIM(old.config->>'recipients')),
          updated_at = now()
      FROM plugin_instances old
      WHERE old.plugin_id = $1
        AND inbox.plugin_id = $2
        AND inbox.organization_id = old.organization_id
        AND NULLIF(TRIM(old.config->>'recipients'), '') IS NOT NULL
        AND NULLIF(TRIM(inbox.config->>'notificationRecipients'), '') IS NULL
      `,
      [oldId, newId],
    );
    await queryRunner.query(
      `
      DELETE FROM plugin_instances old
      USING plugin_instances inbox
      WHERE old.plugin_id = $1
        AND inbox.plugin_id = $2
        AND inbox.organization_id = old.organization_id
      `,
      [oldId, newId],
    );

    // Orgs with only the old plugin: move the instance to Email inbox.
    await queryRunner.query(
      `
      UPDATE plugin_instances
      SET plugin_id = $2,
          config = (COALESCE(config, '{}'::jsonb) - 'recipients')
            || CASE
                 WHEN NULLIF(TRIM(config->>'recipients'), '') IS NOT NULL
                 THEN jsonb_build_object('notificationRecipients', TRIM(config->>'recipients'))
                 ELSE '{}'::jsonb
               END,
          running = false,
          process_id = NULL,
          status = 'stopped',
          runtime_state = 'stopped',
          last_error = NULL,
          restart_count = 0,
          health_status = NULL,
          updated_at = now()
      WHERE plugin_id = $1
      `,
      [oldId, newId],
    );

    await queryRunner.query(`DELETE FROM plugin_registry WHERE id = $1`, [oldId]);
  }

  private async rewriteActionReferences(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column } of REFERENCE_COLUMNS) {
      const typeRows: Array<{ data_type: string }> = await queryRunner.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
        [table, column],
      );
      const dataType = typeRows[0]?.data_type;
      if (!dataType) {
        continue; // column absent on this host: nothing to rewrite
      }
      const replaced = `REPLACE("${column}"::text, $1, $2)`;
      const value =
        dataType === "jsonb" || dataType === "json" ? `${replaced}::${dataType}` : replaced;
      await queryRunner.query(
        `
        UPDATE "${table}"
        SET "${column}" = ${value}
        WHERE "${column}"::text LIKE '%' || $1 || '%'
        `,
        [OLD_ACTION, NEW_ACTION],
      );
    }
    await queryRunner.query(
      `
      UPDATE conversations
      SET enabled_tools = array_replace(enabled_tools, $1, $2)
      WHERE $1 = ANY(enabled_tools)
      `,
      [OLD_ACTION, NEW_ACTION],
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Irreversible by design: the old plugin's code is gone, and moved or
    // merged instances can no longer be told apart from Email inbox installs.
    console.warn(
      "Warning: MergeEmailPluginIntoEmailInbox cannot be reversed; hay-plugin-email instances were merged into or moved to hay-channel-email and its registry row was deleted. Nothing was changed.",
    );
  }
}
