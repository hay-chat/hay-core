import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrganizationAgentPause1784500000000 implements MigrationInterface {
  name = "AddOrganizationAgentPause1784500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "agent_paused_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "agent_pause_reason" varchar(50);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "agent_paused_at",
        DROP COLUMN IF EXISTS "agent_pause_reason";
    `);
  }
}
