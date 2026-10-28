import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * H4: `plugin_states`, a small per-(organization, plugin) key/value store a
 * plugin worker keeps across restarts (e.g. WooCommerce one-click connects
 * waiting for the store owner). `plugin_id` is the authenticated plugin id
 * (core-stamped); `value` is encrypted JSON; rows past `expires_at` are dead.
 */
export class AddPluginStates1785910000000 implements MigrationInterface {
  name = "AddPluginStates1785910000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plugin_states" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "plugin_id" varchar(255) NOT NULL,
        "key" varchar(255) NOT NULL,
        "value" text NOT NULL,
        "expires_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_plugin_states" PRIMARY KEY ("id"),
        CONSTRAINT "fk_plugin_states_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_plugin_states_key"
        ON "plugin_states" ("organization_id", "plugin_id", "key");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "plugin_states"`);
  }
}
