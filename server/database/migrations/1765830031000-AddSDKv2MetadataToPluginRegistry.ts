import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add SDK v2 metadata fields to plugin_registry
 *
 * Adds plugin-global metadata cache and state fields:
 * - metadata: JSONB cache of /metadata endpoint response
 * - metadata_fetched_at: Timestamp of last metadata fetch
 * - metadata_state: Plugin-global metadata state (missing/fresh/stale/error)
 */
export class AddSDKv2MetadataToPluginRegistry1765830031000 implements MigrationInterface {
  name = "AddSDKv2MetadataToPluginRegistry1765830031000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add metadata fields to plugin_registry
    await queryRunner.query(`
      ALTER TABLE "plugin_registry"
      ADD COLUMN "metadata" jsonb,
      ADD COLUMN "metadata_fetched_at" timestamp with time zone,
      ADD COLUMN "metadata_state" character varying(50) NOT NULL DEFAULT 'missing'
    `);

    // Create index on metadata_state for efficient querying
    await queryRunner.query(`
      CREATE INDEX "idx_plugin_registry_metadata_state"
      ON "plugin_registry" ("metadata_state")
    `);

    // Create index on checksum for change detection
    // (checksum field already exists, but we may not have index)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_plugin_registry_checksum"
      ON "plugin_registry" ("checksum")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_plugin_registry_checksum"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_plugin_registry_metadata_state"`);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE "plugin_registry"
      DROP COLUMN "metadata_state",
      DROP COLUMN "metadata_fetched_at",
      DROP COLUMN "metadata"
    `);
  }
}
