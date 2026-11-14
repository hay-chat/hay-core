import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Visitor feedback on AI answers (webchat thumbs up/down) lives in
 * `message_feedback` beside the team's ratings:
 * - `source`: "operator" (a team member in the dashboard) or "visitor".
 * - `reviewer_id` becomes nullable: a visitor is not a user.
 * - One visitor rating per message (partial unique index): rating again replaces it.
 *
 * `down` deletes visitor feedback before restoring NOT NULL on reviewer_id.
 */
export class AddVisitorMessageFeedback1794900300000 implements MigrationInterface {
  name = "AddVisitorMessageFeedback1794900300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "message_feedback"
        ADD COLUMN IF NOT EXISTS "source" varchar(16) NOT NULL DEFAULT 'operator'
    `);
    await queryRunner.query(`
      ALTER TABLE "message_feedback"
        DROP CONSTRAINT IF EXISTS "chk_message_feedback_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "message_feedback"
        ADD CONSTRAINT "chk_message_feedback_source" CHECK ("source" IN ('operator', 'visitor'))
    `);
    await queryRunner.query(
      `ALTER TABLE "message_feedback" ALTER COLUMN "reviewer_id" DROP NOT NULL`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_message_feedback_visitor_message"
        ON "message_feedback" ("message_id") WHERE "source" = 'visitor'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_message_feedback_visitor_message"`);
    await queryRunner.query(`DELETE FROM "message_feedback" WHERE "reviewer_id" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "message_feedback" ALTER COLUMN "reviewer_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "message_feedback" DROP CONSTRAINT IF EXISTS "chk_message_feedback_source"
    `);
    await queryRunner.query(`ALTER TABLE "message_feedback" DROP COLUMN IF EXISTS "source"`);
  }
}
