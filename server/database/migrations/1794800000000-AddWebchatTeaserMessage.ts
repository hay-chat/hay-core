import { MigrationInterface, QueryRunner } from "typeorm";

/** The message shown next to the chat button before the chat is opened (null = none). */
export class AddWebchatTeaserMessage1794800000000 implements MigrationInterface {
  name = "AddWebchatTeaserMessage1794800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
        ADD COLUMN IF NOT EXISTS "teaser_message" varchar(200);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webchat_settings" DROP COLUMN IF EXISTS "teaser_message"`,
    );
  }
}
