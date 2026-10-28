import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D9-10: webchat under-attack mode. While `under_attack_until` is in the
 * future every visitor gets the bot challenge before their first message.
 * `under_attack_source` says who turned it on: "owner" or "auto" (create-rate
 * threshold).
 */
export class AddWebchatUnderAttack1785783400000 implements MigrationInterface {
  name = "AddWebchatUnderAttack1785783400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        ADD COLUMN IF NOT EXISTS "under_attack_until" timestamptz,
        ADD COLUMN IF NOT EXISTS "under_attack_source" varchar(20)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        DROP COLUMN IF EXISTS "under_attack_source",
        DROP COLUMN IF EXISTS "under_attack_until"
    `);
  }
}
