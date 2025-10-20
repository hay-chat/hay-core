import { MigrationInterface, QueryRunner } from "typeorm";

export class ConvertApiKeysToOrganizationTokens1761010000000 implements MigrationInterface {
  name = "ConvertApiKeysToOrganizationTokens1761010000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Delete all existing API keys (fresh start)
    await queryRunner.query(`DELETE FROM "api_keys"`);

    // Drop old index for user_id
    await queryRunner.query(`DROP INDEX "public"."idx_api_keys_user_id"`);

    // Drop old index for organization (we'll recreate with better name)
    await queryRunner.query(`DROP INDEX "public"."idx_api_keys_organization"`);

    // Drop foreign key constraint for user_id if it exists
    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "FK_api_keys_user"`,
    );

    // Remove user_id column
    await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "user_id"`);

    // Make organization_id required (NOT NULL)
    await queryRunner.query(
      `ALTER TABLE "api_keys" ALTER COLUMN "organization_id" SET NOT NULL`,
    );

    // Create new index for organization_id
    await queryRunner.query(
      `CREATE INDEX "idx_api_keys_organization_id" ON "api_keys" ("organization_id")`,
    );

    // Add foreign key constraint for organization_id
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD CONSTRAINT "FK_api_keys_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop organization foreign key
    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP CONSTRAINT "FK_api_keys_organization"`,
    );

    // Drop the new organization_id index
    await queryRunner.query(`DROP INDEX "public"."idx_api_keys_organization_id"`);

    // Make organization_id nullable again
    await queryRunner.query(
      `ALTER TABLE "api_keys" ALTER COLUMN "organization_id" DROP NOT NULL`,
    );

    // Add user_id column back
    await queryRunner.query(`ALTER TABLE "api_keys" ADD "user_id" uuid NOT NULL`);

    // Recreate old indexes
    await queryRunner.query(
      `CREATE INDEX "idx_api_keys_user_id" ON "api_keys" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_api_keys_organization" ON "api_keys" ("organization_id")`,
    );

    // Add foreign key for user_id
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD CONSTRAINT "FK_api_keys_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
