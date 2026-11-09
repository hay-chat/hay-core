import { MigrationInterface, QueryRunner } from "typeorm";

/** Page tools are off for every organization until it turns them on in settings. */
export class AddWebchatPageToolsSetting1794182400100 implements MigrationInterface {
  name = "AddWebchatPageToolsSetting1794182400100";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        ADD COLUMN IF NOT EXISTS "page_tools" jsonb NOT NULL DEFAULT '{"enabled":false}';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "webchat_settings" DROP COLUMN IF EXISTS "page_tools"`);
  }
}
