import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPreChatFormToWebchatSettings1782000000006 implements MigrationInterface {
  name = "AddPreChatFormToWebchatSettings1782000000006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE webchat_settings
      ADD COLUMN IF NOT EXISTS pre_chat_form JSONB NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE webchat_settings
      DROP COLUMN IF EXISTS pre_chat_form
    `);
  }
}
