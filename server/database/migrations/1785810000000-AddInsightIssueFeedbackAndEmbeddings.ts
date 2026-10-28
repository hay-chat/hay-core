import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Insight schema (D3-7), on top of `insight_issues` from 1785100000000.
 *
 * insight_issues gains:
 * - `message_id` / `message_feedback_id`: the rated message and the feedback
 *   row for `source = 'user_feedback'` issues (D3-9). Both ON DELETE SET NULL,
 *   so an issue survives retention deleting the message (which cascades to
 *   its feedback). `message_feedback_id` is unique: one issue per feedback.
 * - `detail`: the AI-enriched explanation of a feedback issue (what went wrong
 *   in the rated reply). PII-redacted like every other text column.
 * - Enrichment state for issues that are inserted first and analysed later
 *   (feedback issues): `enriched_at` NULL = pending, `enrich_attempts`,
 *   `enrich_claimed_until` (lease), `enrich_last_error`. AI-review issues
 *   come out of the close classifier already analysed, so they are written
 *   with `enriched_at` set; existing rows are backfilled to `created_at`.
 *
 * insight_issue_embeddings: one vector per enriched issue for clustering
 * (Insights phase 2), on the product_embeddings pattern: a sibling raw-SQL
 * table with `vector(1536)` and an HNSW cosine index, kept apart from the
 * knowledge chunks in `embeddings`. `content` is the exact (redacted) text
 * that was embedded; `model` lets a model change re-embed selectively.
 */
export class AddInsightIssueFeedbackAndEmbeddings1785810000000 implements MigrationInterface {
  name = "AddInsightIssueFeedbackAndEmbeddings1785810000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "insight_issues"
        ADD COLUMN IF NOT EXISTS "message_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "message_feedback_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "detail" text NULL,
        ADD COLUMN IF NOT EXISTS "enriched_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "enrich_attempts" int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "enrich_claimed_until" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "enrich_last_error" text NULL
    `);
    await queryRunner.query(
      `UPDATE "insight_issues" SET "enriched_at" = "created_at" WHERE "enriched_at" IS NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "insight_issues"
        ADD CONSTRAINT "fk_insight_issues_message" FOREIGN KEY ("message_id")
          REFERENCES "messages"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "fk_insight_issues_message_feedback" FOREIGN KEY ("message_feedback_id")
          REFERENCES "message_feedback"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "uq_insight_issues_message_feedback" UNIQUE ("message_feedback_id")
    `);
    // The enrichment job's queue: pending feedback issues, oldest first.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_insight_issues_pending_enrichment"
        ON "insight_issues" ("created_at") WHERE "enriched_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insight_issue_embeddings" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"  uuid NOT NULL,
        "insight_issue_id" uuid NOT NULL,
        "content"          text NOT NULL,
        "model"            varchar(128) NOT NULL,
        "embedding"        vector(1536) NOT NULL,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_insight_issue_embeddings_issue" UNIQUE ("insight_issue_id"),
        CONSTRAINT "fk_insight_issue_embeddings_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_insight_issue_embeddings_issue" FOREIGN KEY ("insight_issue_id")
          REFERENCES "insight_issues"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_insight_issue_embeddings_org"
        ON "insight_issue_embeddings" ("organization_id")
    `);

    // HNSW build memory tuning — matches the embeddings and product HNSW migrations.
    await queryRunner.query(`SET LOCAL max_parallel_maintenance_workers = 0`);
    await queryRunner.query(`SET LOCAL maintenance_work_mem = '1GB'`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_insight_issue_embeddings_hnsw"
        ON "insight_issue_embeddings" USING hnsw ("embedding" vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "insight_issue_embeddings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_insight_issues_pending_enrichment"`);
    // Feedback issues do not exist before this migration.
    await queryRunner.query(`DELETE FROM "insight_issues" WHERE "source" <> 'ai_review'`);
    await queryRunner.query(`
      ALTER TABLE "insight_issues"
        DROP CONSTRAINT IF EXISTS "uq_insight_issues_message_feedback",
        DROP CONSTRAINT IF EXISTS "fk_insight_issues_message_feedback",
        DROP CONSTRAINT IF EXISTS "fk_insight_issues_message",
        DROP COLUMN IF EXISTS "enrich_last_error",
        DROP COLUMN IF EXISTS "enrich_claimed_until",
        DROP COLUMN IF EXISTS "enrich_attempts",
        DROP COLUMN IF EXISTS "enriched_at",
        DROP COLUMN IF EXISTS "detail",
        DROP COLUMN IF EXISTS "message_feedback_id",
        DROP COLUMN IF EXISTS "message_id"
    `);
  }
}
