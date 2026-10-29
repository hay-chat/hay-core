import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * CSAT in the webchat: an on/off switch and an optional custom question per
 * organization (null = the widget's localized default), and the shopper's
 * 1-5 rating on the conversation.
 */
export class AddCsatToWebchat1785970000000 implements MigrationInterface {
  name = "AddCsatToWebchat1785970000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webchat_settings" ADD COLUMN IF NOT EXISTS "csat_enabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "webchat_settings" ADD COLUMN IF NOT EXISTS "csat_question" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "csat_rating" smallint`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "csat_rated_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "csat_rated_at"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "csat_rating"`);
    await queryRunner.query(`ALTER TABLE "webchat_settings" DROP COLUMN IF EXISTS "csat_question"`);
    await queryRunner.query(`ALTER TABLE "webchat_settings" DROP COLUMN IF EXISTS "csat_enabled"`);
  }
}
