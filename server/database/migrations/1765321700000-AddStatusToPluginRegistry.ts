import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStatusToPluginRegistry1765321700000 implements MigrationInterface {
  name = "AddStatusToPluginRegistry1765321700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add status column to plugin_registry table
    await queryRunner.query(`
      ALTER TABLE "plugin_registry"
      ADD COLUMN "status" character varying(50) NOT NULL DEFAULT 'available'
    `);

    // Create index on status column for efficient filtering
    await queryRunner.query(`
      CREATE INDEX "idx_plugin_registry_status" ON "plugin_registry" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(`DROP INDEX "public"."idx_plugin_registry_status"`);

    // Drop status column
    await queryRunner.query(`ALTER TABLE "plugin_registry" DROP COLUMN "status"`);
  }
}
