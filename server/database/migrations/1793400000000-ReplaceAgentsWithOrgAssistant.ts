import { MigrationInterface, QueryRunner } from "typeorm";

/** A stored JSON document as is; plain text as one paragraph per line. */
function toTiptapDoc(stored: string): unknown {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (parsed === null || typeof parsed === "object") return parsed;
  } catch {
    // plain text
  }
  return {
    type: "doc",
    content: stored
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}

/**
 * One assistant per organization: the agent's persona and hand-off settings
 * move onto `organizations`, and agents go away.
 *
 * Each organization takes the settings of its default agent, else its oldest
 * agent (organizations without an agent keep nulls). An agent's language
 * becomes the organization's `default_language` and its approval setting
 * (`test_mode`, null = inherit) becomes `settings.testModeDefault`.
 * `agents.enabled`, `agents.channels` and `agents.trigger` are not kept: the
 * organization-level AI pause replaces `enabled`, and with a single assistant
 * there is nothing to route by channel or trigger.
 *
 * Down only drops the new columns; agents are not restored.
 */
export class ReplaceAgentsWithOrgAssistant1793400000000 implements MigrationInterface {
  name = "ReplaceAgentsWithOrgAssistant1793400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN "assistant_name" varchar(255),
        ADD COLUMN "assistant_description" text,
        ADD COLUMN "assistant_avatar_upload_id" uuid,
        ADD COLUMN "assistant_instructions" jsonb,
        ADD COLUMN "assistant_tone" text,
        ADD COLUMN "assistant_avoid" text,
        ADD COLUMN "initial_greeting" text,
        ADD COLUMN "human_handoff_available_instructions" jsonb,
        ADD COLUMN "human_handoff_unavailable_instructions" jsonb,
        ADD COLUMN "human_handoff_unavailable_ticket" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD CONSTRAINT "UQ_organizations_assistant_avatar_upload_id" UNIQUE ("assistant_avatar_upload_id"),
        ADD CONSTRAINT "FK_organizations_assistant_avatar_upload"
          FOREIGN KEY ("assistant_avatar_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL
    `);

    const chosenAgents = `
      SELECT DISTINCT ON (a.organization_id) a.*
      FROM "agents" a
      JOIN "organizations" o ON o.id = a.organization_id
      ORDER BY a.organization_id, (a.id = o.default_agent_id) DESC NULLS LAST, a.created_at ASC`;

    await queryRunner.query(`
      WITH chosen AS (${chosenAgents})
      UPDATE "organizations" o SET
        "assistant_name" = c.name,
        "assistant_description" = c.description,
        "assistant_avatar_upload_id" = c.avatar_upload_id,
        "assistant_tone" = c.tone,
        "assistant_avoid" = c.avoid,
        "initial_greeting" = c.initial_greeting,
        "human_handoff_available_instructions" = c.human_handoff_available_instructions,
        "human_handoff_unavailable_instructions" = c.human_handoff_unavailable_instructions,
        "human_handoff_unavailable_ticket" = c.human_handoff_unavailable_ticket,
        "default_language" = CASE
          WHEN c.language IN (
            SELECT unnest(enum_range(NULL::"public"."organizations_default_language_enum"))::text
          )
          THEN c.language::"public"."organizations_default_language_enum"
          ELSE o.default_language
        END,
        "settings" = CASE
          WHEN c.test_mode IS NULL THEN o.settings
          ELSE jsonb_set(COALESCE(o.settings, '{}'::jsonb), '{testModeDefault}', to_jsonb(c.test_mode))
        END
      FROM chosen c
      WHERE c.organization_id = o.id
    `);

    // agents.instructions holds a Tiptap document as JSON, in a text column on
    // some hosts and jsonb on others (see MergeEmailPluginIntoEmailInbox);
    // older rows can hold plain text. Read it as text either way.
    const instructions: Array<{ organization_id: string; instructions: string }> =
      await queryRunner.query(
        `SELECT organization_id, instructions::text AS instructions FROM (${chosenAgents}) c
         WHERE NULLIF(TRIM(instructions::text), '') IS NOT NULL`,
      );
    for (const row of instructions) {
      if (toTiptapDoc(row.instructions) === null) continue;
      await queryRunner.query(
        `UPDATE "organizations" SET "assistant_instructions" = $2::jsonb WHERE id = $1`,
        [row.organization_id, JSON.stringify(toTiptapDoc(row.instructions))],
      );
    }

    // Dropping the columns drops their foreign keys to agents with them.
    await queryRunner.query(`DROP TABLE IF EXISTS "playbook_agents"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "agent_id"`);
    await queryRunner.query(`ALTER TABLE "simulation_runs" DROP COLUMN IF EXISTS "agent_id"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "default_agent_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agents"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP CONSTRAINT IF EXISTS "FK_organizations_assistant_avatar_upload",
        DROP CONSTRAINT IF EXISTS "UQ_organizations_assistant_avatar_upload_id",
        DROP COLUMN IF EXISTS "assistant_name",
        DROP COLUMN IF EXISTS "assistant_description",
        DROP COLUMN IF EXISTS "assistant_avatar_upload_id",
        DROP COLUMN IF EXISTS "assistant_instructions",
        DROP COLUMN IF EXISTS "assistant_tone",
        DROP COLUMN IF EXISTS "assistant_avoid",
        DROP COLUMN IF EXISTS "initial_greeting",
        DROP COLUMN IF EXISTS "human_handoff_available_instructions",
        DROP COLUMN IF EXISTS "human_handoff_unavailable_instructions",
        DROP COLUMN IF EXISTS "human_handoff_unavailable_ticket"
    `);
  }
}
