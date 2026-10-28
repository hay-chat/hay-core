import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Insights observability (D3-11): one row per Insights LLM run (close
 * classification, feedback enrichment, embedding batch) with model, tokens,
 * estimated cost and duration. Tracked, not capped. Raw-SQL table read by the
 * insights metrics route; rows go with the organization.
 */
export class AddInsightRuns1785811000000 implements MigrationInterface {
  name = "AddInsightRuns1785811000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insight_runs" (
        "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"      uuid NOT NULL,
        "kind"                 varchar(32) NOT NULL,
        "model"                varchar(128) NULL,
        "items"                int NOT NULL DEFAULT 1,
        "prompt_tokens"        int NOT NULL DEFAULT 0,
        "cached_prompt_tokens" int NOT NULL DEFAULT 0,
        "completion_tokens"    int NOT NULL DEFAULT 0,
        "estimated_cost_usd"   numeric(12, 6) NULL,
        "duration_ms"          int NOT NULL,
        "succeeded"            boolean NOT NULL,
        "created_at"           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_insight_runs_kind"
          CHECK ("kind" IN ('close_classification', 'feedback_enrichment', 'embedding')),
        CONSTRAINT "fk_insight_runs_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_insight_runs_org_created"
        ON "insight_runs" ("organization_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "insight_runs"`);
  }
}
