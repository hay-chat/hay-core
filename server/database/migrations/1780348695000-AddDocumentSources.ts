import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add document_sources table and external-sync columns on documents.
 *
 * document_sources represents a configured external source (e.g. a Notion
 * workspace, a Google Drive folder) that documents are synced from.
 *
 * Following the recent trend away from native Postgres enums (see
 * ConvertConversationChannelToVarchar), last_sync_status is stored as
 * varchar(20) with a CHECK constraint so new statuses can be introduced
 * without a schema migration.
 */
export class AddDocumentSources1780348695000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_sources" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "plugin_id" varchar(100) NOT NULL,
        "plugin_instance_id" uuid NULL,
        "source_type" varchar(50) NOT NULL,
        "display_name" varchar(255) NOT NULL,
        "external_root_id" varchar(255) NULL,
        "external_root_label" varchar(255) NULL,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "sync_interval_ms" integer NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "last_synced_at" timestamptz NULL,
        "last_sync_cursor" varchar(1024) NULL,
        "last_sync_status" varchar(20) NULL,
        "last_sync_error" text NULL,
        "last_sync_stats" jsonb NULL,
        "last_full_sweep_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_document_sources_last_sync_status"
          CHECK ("last_sync_status" IS NULL OR "last_sync_status" IN ('idle', 'running', 'success', 'error', 'partial'))
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "document_sources"
      ADD CONSTRAINT "fk_document_sources_plugin_instance_id"
      FOREIGN KEY ("plugin_instance_id")
      REFERENCES "plugin_instances"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_document_sources_org_type"
      ON "document_sources" ("organization_id", "source_type")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_document_sources_enabled"
      ON "document_sources" ("enabled")
    `);

    await queryRunner.query(`
      ALTER TABLE "documents"
      ADD COLUMN IF NOT EXISTS "document_source_id" uuid NULL,
      ADD COLUMN IF NOT EXISTS "external_id" varchar(255) NULL,
      ADD COLUMN IF NOT EXISTS "external_updated_at" timestamptz NULL,
      ADD COLUMN IF NOT EXISTS "external_url" text NULL,
      ADD COLUMN IF NOT EXISTS "excluded_from_sync" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "documents"
      ADD CONSTRAINT "fk_documents_document_source"
      FOREIGN KEY ("document_source_id")
      REFERENCES "document_sources"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_documents_source_external"
      ON "documents" ("document_source_id", "external_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_documents_source_external"
      ON "documents" ("document_source_id", "external_id")
      WHERE "document_source_id" IS NOT NULL AND "external_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_documents_source_external"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_documents_source_external"`);

    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "fk_documents_document_source"`,
    );

    await queryRunner.query(`
      ALTER TABLE "documents"
      DROP COLUMN IF EXISTS "excluded_from_sync",
      DROP COLUMN IF EXISTS "external_url",
      DROP COLUMN IF EXISTS "external_updated_at",
      DROP COLUMN IF EXISTS "external_id",
      DROP COLUMN IF EXISTS "document_source_id"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_sources_enabled"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_sources_org_type"`);

    await queryRunner.query(
      `ALTER TABLE "document_sources" DROP CONSTRAINT IF EXISTS "fk_document_sources_plugin_instance_id"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "document_sources"`);
  }
}
