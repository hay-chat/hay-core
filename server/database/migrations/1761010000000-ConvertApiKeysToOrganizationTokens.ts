import { MigrationInterface, QueryRunner } from "typeorm";

export class ConvertApiKeysToOrganizationTokens1761010000000 implements MigrationInterface {
  name = "ConvertApiKeysToOrganizationTokens1761010000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log("\n⚠️  API KEY MIGRATION WARNING ⚠️");
    console.log("This migration converts user-based API keys to organization-based tokens.");
    console.log("Existing API keys will be PRESERVED but may need manual review.\n");

    // Check if user_id column exists
    const hasUserIdColumn = await queryRunner.hasColumn("api_keys", "user_id");

    if (hasUserIdColumn) {
      // Migrate existing keys: For keys with user_id, populate organization_id from user's organization
      await queryRunner.query(`
        UPDATE "api_keys" ak
        SET "organization_id" = u."organization_id"
        FROM "users" u
        WHERE ak."user_id" = u.id
        AND ak."organization_id" IS NULL
      `);

      // Delete any orphaned keys (user no longer exists or has no organization)
      const orphanedKeys = await queryRunner.query(`
        SELECT COUNT(*) as count FROM "api_keys"
        WHERE "organization_id" IS NULL
      `);

      if (orphanedKeys[0].count > 0) {
        console.log(`⚠️  Found ${orphanedKeys[0].count} orphaned API keys (no valid organization). These will be deleted.`);
        await queryRunner.query(`DELETE FROM "api_keys" WHERE "organization_id" IS NULL`);
      }

      // Drop old index for user_id
      await queryRunner.query(`DROP INDEX IF EXISTS "idx_api_keys_user_id"`);

      // Drop foreign key constraint for user_id if it exists
      await queryRunner.query(
        `ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "FK_api_keys_user"`,
      );

      // Remove user_id column
      await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "user_id"`);
    }

    // Drop old organization index (we'll recreate with better name)
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_api_keys_organization"`);

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

    console.log("✅ API key migration completed successfully.");
    console.log("📝 ACTION REQUIRED: Review your API keys in the dashboard at /settings/api-tokens\n");
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
