import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D2-7/D2-8: `disputes`, payment disputes (chargebacks) reported by plugins
 * with the `disputes` capability. `plugin_id` is the reporting plugin
 * (core-stamped); one row per (organization, plugin, external id). The row
 * holds no customer data beyond the order reference; it goes with the org.
 */
export class AddDisputes1785860000000 implements MigrationInterface {
  name = "AddDisputes1785860000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "disputes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "plugin_id" varchar(255) NOT NULL,
        "external_id" varchar(255) NOT NULL,
        "status" varchar(24) NOT NULL,
        "amount" varchar(32),
        "currency" varchar(3),
        "reason" varchar(64),
        "evidence_due_by" timestamptz,
        "initiated_at" timestamptz,
        "order_refs" jsonb NOT NULL DEFAULT '[]',
        "order_label" varchar(64),
        "provider_url" text,
        "order_key" varchar(64),
        "order_plugin_id" varchar(255),
        "evidence_status" varchar(16) NOT NULL DEFAULT 'none',
        "evidence_pushed_at" timestamptz,
        "evidence_pushed_by" uuid,
        "evidence_error" text,
        "alerted_at" timestamptz,
        "reminded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_disputes" PRIMARY KEY ("id"),
        CONSTRAINT "chk_disputes_status" CHECK (
          "status" IN ('needs_response', 'under_review', 'won', 'lost', 'closed')
        ),
        CONSTRAINT "chk_disputes_evidence_status" CHECK (
          "evidence_status" IN ('none', 'drafted', 'failed')
        ),
        CONSTRAINT "fk_disputes_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_disputes_external"
        ON "disputes" ("organization_id", "plugin_id", "external_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_disputes_org_due"
        ON "disputes" ("organization_id", "evidence_due_by");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "disputes"`);
  }
}
