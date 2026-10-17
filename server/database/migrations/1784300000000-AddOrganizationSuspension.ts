import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrganizationSuspension1784300000000 implements MigrationInterface {
  name = "AddOrganizationSuspension1784300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "suspended_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "suspension_reason" varchar(50),
        ADD COLUMN IF NOT EXISTS "suspension_redirect_url" varchar(2048),
        ADD COLUMN IF NOT EXISTS "access_notice" jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "suspended_at",
        DROP COLUMN IF EXISTS "suspension_reason",
        DROP COLUMN IF EXISTS "suspension_redirect_url",
        DROP COLUMN IF EXISTS "access_notice";
    `);
  }
}
