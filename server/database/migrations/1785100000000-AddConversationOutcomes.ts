import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D1-3 + D3-8: the close classifier's records.
 *
 * - `unresolved` conversation status (D5-5) for unhappy and abandoned closes.
 * - `conversations.spam_flagged_at` / `spam_reason` (D9-5): spam never bills.
 * - `conversation_outcomes`: one billing outcome per close. The billable count
 *   reads this table from now on.
 * - `insight_issues`: one QA event per classified close, for the Insights engine.
 *
 * Backfill: every resolved conversation gets an outcome row with the Wave 0
 * rule (test, unhappy and handed-off never bill; everything else bills), so
 * the count of the current billing period does not move on deploy. Historic
 * rows are marked `backfill` and are not sent to the LLM. Re-classifying them
 * (retroactive credits) is a separate script.
 */
export class AddConversationOutcomes1785100000000 implements MigrationInterface {
  name = "AddConversationOutcomes1785100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "conversations_status_enum" ADD VALUE IF NOT EXISTS 'unresolved';
    `);

    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD COLUMN IF NOT EXISTS "spam_flagged_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "spam_reason" varchar(255);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation_outcomes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "conversation_id" uuid,
        "closed_at" timestamptz NOT NULL,
        "close_status" varchar(32) NOT NULL,
        "close_reason" varchar(64),
        "outcome" varchar(32) NOT NULL,
        "billable" boolean NOT NULL,
        "ai_resolved" boolean NOT NULL,
        "handed_off" boolean NOT NULL,
        "classified_by" varchar(16) NOT NULL,
        "classification_reason" text,
        "classified_at" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0,
        "claimed_until" timestamptz,
        "last_error" text,
        "reversed_at" timestamptz,
        "reversal_reason" varchar(64),
        "llm_model" varchar(128),
        "llm_usage" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_conversation_outcomes" PRIMARY KEY ("id"),
        CONSTRAINT "uq_conversation_outcomes_conversation_closed_at"
          UNIQUE ("conversation_id", "closed_at"),
        CONSTRAINT "fk_conversation_outcomes_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_conversation_outcomes_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_conversation_outcomes_org_closed_at"
        ON "conversation_outcomes" ("organization_id", "closed_at");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_conversation_outcomes_pending"
        ON "conversation_outcomes" ("created_at") WHERE "classified_at" IS NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insight_issues" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "source" varchar(32) NOT NULL,
        "conversation_id" uuid,
        "conversation_outcome_id" uuid,
        "polarity" varchar(16) NOT NULL,
        "action_type" varchar(32) NOT NULL,
        "severity" varchar(16) NOT NULL,
        "confidence" real NOT NULL,
        "relevance" integer NOT NULL,
        "summary" text NOT NULL,
        "root_cause" text,
        "area" varchar(64),
        "snippet" text,
        "paraphrase" text,
        "signals" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_insight_issues" PRIMARY KEY ("id"),
        CONSTRAINT "uq_insight_issues_conversation_outcome" UNIQUE ("conversation_outcome_id"),
        CONSTRAINT "fk_insight_issues_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_insight_issues_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_insight_issues_conversation_outcome" FOREIGN KEY ("conversation_outcome_id")
          REFERENCES "conversation_outcomes"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_insight_issues_org_created_at"
        ON "insight_issues" ("organization_id", "created_at");
    `);

    await queryRunner.query(`
      WITH classified AS (
        SELECT
          c."id",
          c."organization_id",
          COALESCE(GREATEST(c."ended_at", c."closed_at"), c."created_at") AS "closed_at",
          c."resolution_metadata"->>'reason' AS "close_reason",
          c."handed_off_at" IS NOT NULL AS "handed_off",
          CASE
            WHEN COALESCE(c."metadata"->>'sourceId', '') = 'playground'
              OR COALESCE(c."metadata"->>'test_mode', 'false') = 'true'
              OR COALESCE(c."metadata"->>'isPlayground', 'false') = 'true'
              OR c."metadata"->>'runKind' IS NOT NULL THEN 'test'
            WHEN COALESCE(c."resolution_metadata"->>'reason', '')
              = 'user_indicated_close_unsatisfied' THEN 'unhappy'
            WHEN c."handed_off_at" IS NOT NULL THEN 'human'
            WHEN c."resolution_metadata"->>'reason'
              IN ('user_indicated_close_satisfied', 'user_indicated_greet') THEN 'confirmed'
            ELSE 'assumed'
          END AS "outcome"
        FROM "conversations" c
        WHERE c."status" = 'resolved' AND c."deleted_at" IS NULL
      )
      INSERT INTO "conversation_outcomes" (
        "organization_id", "conversation_id", "closed_at", "close_status", "close_reason",
        "outcome", "billable", "ai_resolved", "handed_off", "classified_by", "classified_at"
      )
      SELECT
        "organization_id", "id", "closed_at", 'resolved', "close_reason",
        "outcome", "outcome" IN ('confirmed', 'assumed'), "outcome" IN ('confirmed', 'assumed'),
        "handed_off", 'backfill', now()
      FROM classified
      ON CONFLICT ("conversation_id", "closed_at") DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "insight_issues";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_outcomes";`);
    await queryRunner.query(`
      ALTER TABLE "conversations"
        DROP COLUMN IF EXISTS "spam_reason",
        DROP COLUMN IF EXISTS "spam_flagged_at";
    `);
    // PostgreSQL cannot drop an enum value without recreating the type. Move
    // rows off it so the old code still reads them; the value stays.
    await queryRunner.query(`
      UPDATE "conversations" SET "status" = 'resolved' WHERE "status" = 'unresolved';
    `);
  }
}
