import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add SDK v2 runtime state and auth fields to plugin_instances
 *
 * Adds org-scoped runtime state and auth separation:
 * - auth_state: JSONB containing methodId and credentials (separate from config)
 * - auth_validated_at: Timestamp of last successful auth validation
 * - runtime_state: Org-scoped worker lifecycle state (stopped/starting/ready/degraded/error)
 */
export class AddSDKv2RuntimeStateToPluginInstance1765830032000 implements MigrationInterface {
  name = "AddSDKv2RuntimeStateToPluginInstance1765830032000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add auth state fields
    await queryRunner.query(`
      ALTER TABLE "plugin_instances"
      ADD COLUMN "auth_state" jsonb,
      ADD COLUMN "auth_validated_at" timestamp with time zone
    `);

    // Add runtime state field
    await queryRunner.query(`
      ALTER TABLE "plugin_instances"
      ADD COLUMN "runtime_state" character varying(50) NOT NULL DEFAULT 'stopped'
    `);

    // Create index on runtime_state for efficient querying
    await queryRunner.query(`
      CREATE INDEX "idx_plugin_instances_runtime_state"
      ON "plugin_instances" ("runtime_state")
    `);

    // Create composite index for org + plugin + runtime_state queries
    await queryRunner.query(`
      CREATE INDEX "idx_plugin_instances_org_plugin_runtime"
      ON "plugin_instances" ("organization_id", "plugin_id", "runtime_state")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_plugin_instances_org_plugin_runtime"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_plugin_instances_runtime_state"`);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE "plugin_instances"
      DROP COLUMN "runtime_state",
      DROP COLUMN "auth_validated_at",
      DROP COLUMN "auth_state"
    `);
  }
}
