import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOAuthSupport1764000000000 implements MigrationInterface {
  name = "AddOAuthSupport1764000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add auth_method column to plugin_instances table
    await queryRunner.query(
      `ALTER TABLE "plugin_instances" ADD COLUMN "auth_method" VARCHAR(50) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove auth_method column
    await queryRunner.query(
      `ALTER TABLE "plugin_instances" DROP COLUMN "auth_method"`,
    );
  }
}


