import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A background image for the help center's hero (theme heroStyle "image").
 * The other new theme settings live in the `theme` jsonb and need no column.
 */
export class AddHelpCenterHeroImage1795000300000 implements MigrationInterface {
  name = "AddHelpCenterHeroImage1795000300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "help_centers" ADD COLUMN IF NOT EXISTS "hero_image_upload_id" uuid;
    `);
    await queryRunner.query(`
      ALTER TABLE "help_centers"
        DROP CONSTRAINT IF EXISTS "uq_help_centers_hero_image_upload_id",
        ADD CONSTRAINT "uq_help_centers_hero_image_upload_id" UNIQUE ("hero_image_upload_id"),
        DROP CONSTRAINT IF EXISTS "fk_help_centers_hero_image_upload",
        ADD CONSTRAINT "fk_help_centers_hero_image_upload"
          FOREIGN KEY ("hero_image_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "help_centers"
        DROP CONSTRAINT IF EXISTS "fk_help_centers_hero_image_upload",
        DROP CONSTRAINT IF EXISTS "uq_help_centers_hero_image_upload_id",
        DROP COLUMN IF EXISTS "hero_image_upload_id";
    `);
  }
}
