import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add plugin_webhook_routes table.
 *
 * A plugin-agnostic index mapping (plugin_id, routing_key) to the organization
 * and plugin instance that owns it. Lets a shared webhook endpoint resolve which
 * org/instance an inbound account/routing key belongs to without the core having
 * any per-plugin knowledge.
 *
 * The (plugin_id, routing_key) pair is unique so that the last connect wins:
 * reassigning a routing key updates the existing row in place.
 */
export class AddPluginWebhookRoutes1782000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plugin_webhook_routes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "plugin_id" varchar(100) NOT NULL,
        "routing_key" varchar(255) NOT NULL,
        "organization_id" uuid NOT NULL,
        "plugin_instance_id" uuid NOT NULL,
        "created_by" varchar NULL,
        "updated_by" varchar NULL,
        "metadata" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "plugin_webhook_routes"
      ADD CONSTRAINT "fk_plugin_webhook_routes_plugin_instance_id"
      FOREIGN KEY ("plugin_instance_id")
      REFERENCES "plugin_instances"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_plugin_webhook_routes_plugin_key"
      ON "plugin_webhook_routes" ("plugin_id", "routing_key")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_plugin_webhook_routes_organization_id"
      ON "plugin_webhook_routes" ("organization_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_plugin_webhook_routes_organization_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_plugin_webhook_routes_plugin_key"`);

    await queryRunner.query(
      `ALTER TABLE "plugin_webhook_routes" DROP CONSTRAINT IF EXISTS "fk_plugin_webhook_routes_plugin_instance_id"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "plugin_webhook_routes"`);
  }
}
