import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCsatToWebchat1781300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Webchat settings: enable flag + customizable CSAT question
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
      ADD COLUMN "csat_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "webchat_settings"
      ADD COLUMN "csat_question" text NOT NULL DEFAULT 'How would you rate the support you received today?'
    `);

    // Conversation: store the submitted rating (1-5) and when it was given
    await queryRunner.query(`
      ALTER TABLE "conversations" ADD COLUMN "csat_rating" smallint
    `);
    await queryRunner.query(`
      ALTER TABLE "conversations" ADD COLUMN "csat_rated_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "csat_rated_at"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "csat_rating"`);
    await queryRunner.query(`ALTER TABLE "webchat_settings" DROP COLUMN IF EXISTS "csat_question"`);
    await queryRunner.query(`ALTER TABLE "webchat_settings" DROP COLUMN IF EXISTS "csat_enabled"`);
  }
}
