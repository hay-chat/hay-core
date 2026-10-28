import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Insights phase 2 and 3 (D3-12..D3-18): clusters of insight issues, their
 * lifecycle audit, and per-organization job state. Raw-SQL tables (pgvector
 * centroid), read and written by services/insights/*.
 *
 * - insight_clusters: one pattern across issues. `origin = 'clustering'`
 *   rows come from the nightly incremental clustering (centroid = mean of the
 *   member vectors); `origin = 'docs_audit'` rows are org-level findings of
 *   the weekly docs audit / broken action check, keyed by `dedupe_key`, and
 *   have no centroid. Text columns are copied from PII-redacted issues, so a
 *   cluster may outlive conversation retention (Roger, D3 decision 8).
 *   `promoted_at` NULL = below the promotion gate, not shown to the owner.
 *   `merged_into_id` set = merged into another cluster, hidden.
 * - insight_cluster_members: an issue belongs to at most one cluster.
 * - insight_state_audit: every lifecycle change (user, or NULL for the system:
 *   recurrence, merge).
 * - insight_org_state: backfill progress, last digest and docs audit run.
 *
 * insight_runs gains the kinds cluster_naming, docs_audit and backfill_review.
 * insight_issues.source gains docs_audit (no constraint on that column).
 */
export class AddInsightClusters1785840000000 implements MigrationInterface {
  name = "AddInsightClusters1785840000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insight_clusters" (
        "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"         uuid NOT NULL,
        "origin"                  varchar(16) NOT NULL DEFAULT 'clustering',
        "dedupe_key"              varchar(255) NULL,
        "polarity"                varchar(16) NOT NULL,
        "action_type"             varchar(32) NOT NULL,
        "area"                    varchar(64) NULL,
        "signature"               varchar(64) NOT NULL,
        "centroid"                vector(1536) NULL,
        "title"                   text NULL,
        "summary"                 text NULL,
        "hypothesis"              text NULL,
        "named_at"                timestamptz NULL,
        "named_size"              int NOT NULL DEFAULT 0,
        "snippets"                jsonb NOT NULL DEFAULT '[]'::jsonb,
        "paraphrases"             jsonb NOT NULL DEFAULT '[]'::jsonb,
        "size"                    int NOT NULL DEFAULT 0,
        "window_size"             int NOT NULL DEFAULT 0,
        "negative_count"          int NOT NULL DEFAULT 0,
        "high_severity_count"     int NOT NULL DEFAULT 0,
        "feedback_negative_count" int NOT NULL DEFAULT 0,
        "conversation_count"      int NOT NULL DEFAULT 0,
        "handed_off_count"        int NOT NULL DEFAULT 0,
        "avg_relevance"           real NOT NULL DEFAULT 0,
        "impact_score"            real NOT NULL DEFAULT 0,
        "state"                   varchar(16) NOT NULL DEFAULT 'new',
        "state_changed_at"        timestamptz NULL,
        "promoted_at"             timestamptz NULL,
        "first_seen_at"           timestamptz NOT NULL DEFAULT now(),
        "last_seen_at"            timestamptz NOT NULL DEFAULT now(),
        "addressed_at"            timestamptz NULL,
        "recurred_at"             timestamptz NULL,
        "recurrence_count"        int NOT NULL DEFAULT 0,
        "approved_action"         jsonb NULL,
        "merged_into_id"          uuid NULL,
        "created_at"              timestamptz NOT NULL DEFAULT now(),
        "updated_at"              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_insight_clusters_origin" CHECK ("origin" IN ('clustering', 'docs_audit')),
        CONSTRAINT "chk_insight_clusters_state" CHECK ("state" IN
          ('new', 'acknowledged', 'in_progress', 'addressed', 'rejected', 'archived')),
        CONSTRAINT "fk_insight_clusters_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_insight_clusters_merged_into" FOREIGN KEY ("merged_into_id")
          REFERENCES "insight_clusters"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_insight_clusters_org_dedupe_key"
        ON "insight_clusters" ("organization_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_insight_clusters_org_last_seen"
        ON "insight_clusters" ("organization_id", "last_seen_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insight_cluster_members" (
        "insight_issue_id" uuid PRIMARY KEY,
        "cluster_id"       uuid NOT NULL,
        "organization_id"  uuid NOT NULL,
        "similarity"       real NULL,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_insight_cluster_members_issue" FOREIGN KEY ("insight_issue_id")
          REFERENCES "insight_issues"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_insight_cluster_members_cluster" FOREIGN KEY ("cluster_id")
          REFERENCES "insight_clusters"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_insight_cluster_members_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_insight_cluster_members_cluster"
        ON "insight_cluster_members" ("cluster_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insight_state_audit" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "cluster_id"      uuid NOT NULL,
        "from_state"      varchar(16) NULL,
        "to_state"        varchar(16) NOT NULL,
        "user_id"         uuid NULL,
        "reason"          text NULL,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_insight_state_audit_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_insight_state_audit_cluster" FOREIGN KEY ("cluster_id")
          REFERENCES "insight_clusters"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_insight_state_audit_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_insight_state_audit_cluster"
        ON "insight_state_audit" ("cluster_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insight_org_state" (
        "organization_id"        uuid PRIMARY KEY,
        "backfill_requested_at"  timestamptz NULL,
        "backfill_cursor"        timestamptz NULL,
        "backfill_reviewed"      int NOT NULL DEFAULT 0,
        "backfill_completed_at"  timestamptz NULL,
        "digest_last_sent_at"    timestamptz NULL,
        "docs_audit_last_run_at" timestamptz NULL,
        "updated_at"             timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_insight_org_state_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "insight_runs" DROP CONSTRAINT IF EXISTS "chk_insight_runs_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "insight_runs" ADD CONSTRAINT "chk_insight_runs_kind" CHECK ("kind" IN
        ('close_classification', 'feedback_enrichment', 'embedding',
         'cluster_naming', 'docs_audit', 'backfill_review'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "insight_runs" WHERE "kind" IN ('cluster_naming', 'docs_audit', 'backfill_review')`,
    );
    await queryRunner.query(
      `ALTER TABLE "insight_runs" DROP CONSTRAINT IF EXISTS "chk_insight_runs_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "insight_runs" ADD CONSTRAINT "chk_insight_runs_kind"
        CHECK ("kind" IN ('close_classification', 'feedback_enrichment', 'embedding'))
    `);
    await queryRunner.query(`DELETE FROM "insight_issues" WHERE "source" = 'docs_audit'`);
    await queryRunner.query(`DROP TABLE IF EXISTS "insight_org_state"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "insight_state_audit"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "insight_cluster_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "insight_clusters"`);
  }
}
