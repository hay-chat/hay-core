import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPluginIdToPluginRegistry1756662767509 implements MigrationInterface {
  name = "AddPluginIdToPluginRegistry1756662767509";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the old unique index on name
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ca98e6c96725b732c954a6afc8"`);

    // Add plugin_id column, initially nullable
    await queryRunner.query(`ALTER TABLE "plugin_registry" ADD "plugin_id" character varying(255)`);

    // Copy existing name values to plugin_id
    await queryRunner.query(`UPDATE "plugin_registry" SET "plugin_id" = "name"`);

    // Make plugin_id NOT NULL after populating it
    await queryRunner.query(`ALTER TABLE "plugin_registry" ALTER COLUMN "plugin_id" SET NOT NULL`);

    // Create unique index on plugin_id
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4983091824ced666fb14943432" ON "plugin_registry" ("plugin_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the new unique index on plugin_id
    await queryRunner.query(`DROP INDEX "public"."IDX_4983091824ced666fb14943432"`);

    // Drop the plugin_id column
    await queryRunner.query(`ALTER TABLE "plugin_registry" DROP COLUMN "plugin_id"`);

    // Recreate the unique index on name
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ca98e6c96725b732c954a6afc8" ON "plugin_registry" ("name") `,
    );
  }
}
