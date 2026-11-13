import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The chat button's icon: a preset (chat bubble, sparkle, robot) drawn filled
 * or as an outline, or an SVG the merchant uploaded (stored as a PNG). The
 * defaults keep today's button: an outlined chat bubble.
 */
export class AddWebchatLauncherIcon1794900400000 implements MigrationInterface {
  name = "AddWebchatLauncherIcon1794900400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        ADD COLUMN IF NOT EXISTS "launcher_icon" varchar(10) NOT NULL DEFAULT 'chat',
        ADD COLUMN IF NOT EXISTS "launcher_icon_style" varchar(10) NOT NULL DEFAULT 'outline',
        ADD COLUMN IF NOT EXISTS "launcher_icon_upload_id" uuid;
    `);
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_launcher_icon",
        ADD CONSTRAINT "chk_webchat_settings_launcher_icon"
          CHECK ("launcher_icon" IN ('chat', 'sparkle', 'robot', 'custom')),
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_launcher_icon_style",
        ADD CONSTRAINT "chk_webchat_settings_launcher_icon_style"
          CHECK ("launcher_icon_style" IN ('filled', 'outline')),
        DROP CONSTRAINT IF EXISTS "uq_webchat_settings_launcher_icon_upload_id",
        ADD CONSTRAINT "uq_webchat_settings_launcher_icon_upload_id" UNIQUE ("launcher_icon_upload_id"),
        DROP CONSTRAINT IF EXISTS "fk_webchat_settings_launcher_icon_upload",
        ADD CONSTRAINT "fk_webchat_settings_launcher_icon_upload"
          FOREIGN KEY ("launcher_icon_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        DROP CONSTRAINT IF EXISTS "fk_webchat_settings_launcher_icon_upload",
        DROP CONSTRAINT IF EXISTS "uq_webchat_settings_launcher_icon_upload_id",
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_launcher_icon_style",
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_launcher_icon",
        DROP COLUMN IF EXISTS "launcher_icon_upload_id",
        DROP COLUMN IF EXISTS "launcher_icon_style",
        DROP COLUMN IF EXISTS "launcher_icon";
    `);
  }
}
