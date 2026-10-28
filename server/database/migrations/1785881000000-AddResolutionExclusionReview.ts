import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Lane A3: Hay.chat staff review `pending_review` exclusions from the
 * backoffice. Approve -> `excluded` (leaves the billable count); deny ->
 * `denied` (stays billed, cannot be requested again). Who reviewed, when and
 * the note are kept on the row; the decision is also in audit_logs.
 * `exclusion_reviewed_by` is the staff login from the backoffice, not a core user.
 */
export class AddResolutionExclusionReview1785881000000 implements MigrationInterface {
  name = "AddResolutionExclusionReview1785881000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_outcomes"
        ADD COLUMN IF NOT EXISTS "exclusion_reviewed_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "exclusion_reviewed_by" varchar(255),
        ADD COLUMN IF NOT EXISTS "exclusion_review_note" text;
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_outcomes"
        DROP CONSTRAINT IF EXISTS "chk_conversation_outcomes_exclusion_status",
        ADD CONSTRAINT "chk_conversation_outcomes_exclusion_status"
          CHECK ("exclusion_status" IS NULL OR "exclusion_status" IN ('excluded', 'pending_review', 'denied'));
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_conversation_outcomes_pending_review"
        ON "conversation_outcomes" ("exclusion_requested_at")
        WHERE "exclusion_status" = 'pending_review';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_conversation_outcomes_pending_review";`);
    await queryRunner.query(`
      UPDATE "conversation_outcomes" SET "exclusion_status" = NULL WHERE "exclusion_status" = 'denied';
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_outcomes"
        DROP CONSTRAINT IF EXISTS "chk_conversation_outcomes_exclusion_status",
        ADD CONSTRAINT "chk_conversation_outcomes_exclusion_status"
          CHECK ("exclusion_status" IS NULL OR "exclusion_status" IN ('excluded', 'pending_review')),
        DROP COLUMN IF EXISTS "exclusion_review_note",
        DROP COLUMN IF EXISTS "exclusion_reviewed_by",
        DROP COLUMN IF EXISTS "exclusion_reviewed_at";
    `);
  }
}
