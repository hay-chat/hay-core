import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add health_status to plugin_instances
 *
 * Adds health_status field to track the result of healthchecks:
 * - healthy: Last healthcheck passed
 * - unhealthy: Last healthcheck failed
 * - unknown: No healthcheck performed yet or status unknown
 */
export class AddHealthStatusToPluginInstance1766100000000 implements MigrationInterface {
  name = "AddHealthStatusToPluginInstance1766100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if health_status column exists
    const hasColumn = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'plugin_instances' AND column_name = 'health_status'
    `);

    if (hasColumn.length === 0) {
      // Add health_status column to plugin_instances table
      await queryRunner.query(`
        ALTER TABLE "plugin_instances"
        ADD COLUMN "health_status" VARCHAR(50)
      `);
    }

    // Create index on health_status for efficient querying
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_plugin_instances_health_status"
      ON "plugin_instances" ("health_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_plugin_instances_health_status"`);

    // Drop column
    await queryRunner.query(`
      ALTER TABLE "plugin_instances"
      DROP COLUMN "health_status"
    `);
  }
}
