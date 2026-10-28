import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D11-9: the owner's "Pause AI everywhere" switch. Separate from
 * agent_paused_at, which the external operator owns (usage_limit) and
 * rewrites on every access-state sync.
 */
export class AddOrganizationAiPause1785795000000 implements MigrationInterface {
  name = "AddOrganizationAiPause1785795000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "ai_paused_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "ai_paused_by_user_id" uuid;
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP CONSTRAINT IF EXISTS "fk_organizations_ai_paused_by_user",
        ADD CONSTRAINT "fk_organizations_ai_paused_by_user"
          FOREIGN KEY ("ai_paused_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP CONSTRAINT IF EXISTS "fk_organizations_ai_paused_by_user",
        DROP COLUMN IF EXISTS "ai_paused_by_user_id",
        DROP COLUMN IF EXISTS "ai_paused_at";
    `);
  }
}
