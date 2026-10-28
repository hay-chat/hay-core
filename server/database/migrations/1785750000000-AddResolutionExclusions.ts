import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D1-6: merchant exclusions on the resolution ledger.
 *
 * A billable outcome can be excluded by an owner or admin with a reason.
 * Within the self-serve allowance (5 % of the period) it is excluded at once
 * (`exclusion_status = 'excluded'`, `excluded_at` set) and drops out of the
 * billable count. Beyond it the request is recorded for Hay.chat to review
 * (`exclusion_status = 'pending_review'`, `excluded_at` stays null, still billed).
 * Who, when and why are kept on the row and in audit_logs.
 */
export class AddResolutionExclusions1785750000000 implements MigrationInterface {
  name = "AddResolutionExclusions1785750000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_outcomes"
        ADD COLUMN IF NOT EXISTS "exclusion_status" varchar(16),
        ADD COLUMN IF NOT EXISTS "exclusion_reason" text,
        ADD COLUMN IF NOT EXISTS "exclusion_requested_by" uuid,
        ADD COLUMN IF NOT EXISTS "exclusion_requested_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "excluded_at" timestamptz;
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_outcomes"
        DROP CONSTRAINT IF EXISTS "chk_conversation_outcomes_exclusion_status";
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_outcomes"
        ADD CONSTRAINT "chk_conversation_outcomes_exclusion_status"
        CHECK ("exclusion_status" IS NULL OR "exclusion_status" IN ('excluded', 'pending_review'));
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_outcomes"
        DROP CONSTRAINT IF EXISTS "fk_conversation_outcomes_exclusion_requested_by";
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_outcomes"
        ADD CONSTRAINT "fk_conversation_outcomes_exclusion_requested_by"
        FOREIGN KEY ("exclusion_requested_by") REFERENCES "users"("id") ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_outcomes"
        DROP CONSTRAINT IF EXISTS "fk_conversation_outcomes_exclusion_requested_by",
        DROP CONSTRAINT IF EXISTS "chk_conversation_outcomes_exclusion_status",
        DROP COLUMN IF EXISTS "excluded_at",
        DROP COLUMN IF EXISTS "exclusion_requested_at",
        DROP COLUMN IF EXISTS "exclusion_requested_by",
        DROP COLUMN IF EXISTS "exclusion_reason",
        DROP COLUMN IF EXISTS "exclusion_status";
    `);
  }
}
