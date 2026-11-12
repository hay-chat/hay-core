import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Webchat redesign: the four theme presets and the subtitle give way to a
 * brand colour (imported from the website icon or picked by the merchant), a
 * light/dark/system theme mode, a widget logo, a home heading, and install
 * detection (the last page origin that loaded the widget).
 *
 * Merchants who had picked a non-default preset keep that colour as a custom
 * brand colour, so the website import never overwrites it.
 */
export class WebchatBrandingAndInstallDetection1794900000000 implements MigrationInterface {
  name = "WebchatBrandingAndInstallDetection1794900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        ADD COLUMN IF NOT EXISTS "theme_mode" varchar(10) NOT NULL DEFAULT 'light',
        ADD COLUMN IF NOT EXISTS "brand_color" varchar(7) NOT NULL DEFAULT '#001df5',
        ADD COLUMN IF NOT EXISTS "brand_color_source" varchar(10),
        ADD COLUMN IF NOT EXISTS "brand_palette" text[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "logo_upload_id" uuid,
        ADD COLUMN IF NOT EXISTS "logo_source" varchar(10),
        ADD COLUMN IF NOT EXISTS "branding_imported_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "home_heading" varchar(120),
        ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "last_seen_origin" varchar(255);
    `);

    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_theme_mode",
        ADD CONSTRAINT "chk_webchat_settings_theme_mode"
          CHECK ("theme_mode" IN ('light', 'dark', 'system')),
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_brand_color_source",
        ADD CONSTRAINT "chk_webchat_settings_brand_color_source"
          CHECK ("brand_color_source" IN ('website', 'custom')),
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_logo_source",
        ADD CONSTRAINT "chk_webchat_settings_logo_source"
          CHECK ("logo_source" IN ('website', 'custom')),
        DROP CONSTRAINT IF EXISTS "uq_webchat_settings_logo_upload_id",
        ADD CONSTRAINT "uq_webchat_settings_logo_upload_id" UNIQUE ("logo_upload_id"),
        DROP CONSTRAINT IF EXISTS "fk_webchat_settings_logo_upload",
        ADD CONSTRAINT "fk_webchat_settings_logo_upload"
          FOREIGN KEY ("logo_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL;
    `);

    // A preset other than the default blue was the merchant's choice.
    const themeColumn: Array<{ exists: boolean }> = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'webchat_settings' AND column_name = 'theme'
      ) AS exists
    `);
    if (themeColumn[0]?.exists) {
      await queryRunner.query(`
        UPDATE "webchat_settings"
           SET "brand_color" = CASE "theme"
                 WHEN 'green' THEN '#10b981'
                 WHEN 'purple' THEN '#8b5cf6'
                 WHEN 'black' THEN '#000000'
               END,
               "brand_color_source" = 'custom'
         WHERE "theme" IN ('green', 'purple', 'black');
      `);
    }

    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        DROP CONSTRAINT IF EXISTS "chk_theme",
        DROP COLUMN IF EXISTS "theme",
        DROP COLUMN IF EXISTS "widget_subtitle";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        ADD COLUMN IF NOT EXISTS "widget_subtitle" varchar(200),
        ADD COLUMN IF NOT EXISTS "theme" varchar(20) NOT NULL DEFAULT 'blue';
    `);
    await queryRunner.query(`
      UPDATE "webchat_settings"
         SET "theme" = CASE "brand_color"
               WHEN '#10b981' THEN 'green'
               WHEN '#8b5cf6' THEN 'purple'
               WHEN '#000000' THEN 'black'
               ELSE 'blue'
             END
       WHERE "brand_color_source" = 'custom';
    `);
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        DROP CONSTRAINT IF EXISTS "chk_theme",
        ADD CONSTRAINT "chk_theme" CHECK ("theme" IN ('blue', 'green', 'purple', 'black')),
        DROP CONSTRAINT IF EXISTS "fk_webchat_settings_logo_upload",
        DROP CONSTRAINT IF EXISTS "uq_webchat_settings_logo_upload_id",
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_logo_source",
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_brand_color_source",
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_theme_mode",
        DROP COLUMN IF EXISTS "last_seen_origin",
        DROP COLUMN IF EXISTS "last_seen_at",
        DROP COLUMN IF EXISTS "home_heading",
        DROP COLUMN IF EXISTS "branding_imported_at",
        DROP COLUMN IF EXISTS "logo_source",
        DROP COLUMN IF EXISTS "logo_upload_id",
        DROP COLUMN IF EXISTS "brand_palette",
        DROP COLUMN IF EXISTS "brand_color_source",
        DROP COLUMN IF EXISTS "brand_color",
        DROP COLUMN IF EXISTS "theme_mode";
    `);
  }
}
