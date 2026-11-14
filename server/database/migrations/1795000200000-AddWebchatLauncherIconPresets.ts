import { MigrationInterface, QueryRunner } from "typeorm";

/** More preset chat button icons: speech bubbles, a question mark, headsets and a lifebuoy. */
export class AddWebchatLauncherIconPresets1795000200000 implements MigrationInterface {
  name = "AddWebchatLauncherIconPresets1795000200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_launcher_icon",
        ADD CONSTRAINT "chk_webchat_settings_launcher_icon"
          CHECK ("launcher_icon" IN (
            'chat', 'bubble', 'smiley', 'question', 'sparkle', 'robot',
            'headset', 'agent', 'operator', 'lifebuoy', 'custom'
          ));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "webchat_settings" SET "launcher_icon" = 'chat'
        WHERE "launcher_icon" NOT IN ('chat', 'sparkle', 'robot', 'custom');
    `);
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        DROP CONSTRAINT IF EXISTS "chk_webchat_settings_launcher_icon",
        ADD CONSTRAINT "chk_webchat_settings_launcher_icon"
          CHECK ("launcher_icon" IN ('chat', 'sparkle', 'robot', 'custom'));
    `);
  }
}
