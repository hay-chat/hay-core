import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D11-12: lock-screen privacy. When on, this person's conversation alerts say
 * only "A customer needs a human" (no customer name or summary).
 */
export class AddUserAlertPreviewPrivacy1785796000000 implements MigrationInterface {
  name = "AddUserAlertPreviewPrivacy1785796000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "hide_alert_preview" boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "hide_alert_preview";`);
  }
}
